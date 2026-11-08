// Outcome tracking: what the telemetry says actually happened for every resolved event, next to what the
// console recommended. Pure function on the contract types; persisted by scripts/retrain as data/outcomes/*.json.
import { seriesKey, type Analysis, type Dataset, type Event, type Facility, type Well } from "../data/types";

interface OutcomeBase {
  event_id: string;
  folder: string;
  system: string;
  facility: string;
  asset: string;
  onset_unix: number;
  end_unix: number;
  /** Detector confidence for this event. */
  confidence: number;
  /** Operator / technician verdict, set by the UI or a field-session export. Never set here. */
  verdict?: "confirmed" | "dismissed";
}

export interface PumpFailureOutcome extends OutcomeBase {
  category: "pump_failure";
  /** Highest tank level between onset and repair end. */
  peak_level_pct: number;
  /** Tank reached shutdown and the wells auto shut in. */
  tripped: boolean;
  tripped_at_unix: number | null;
  /** Longest any well of the facility was shut in before the repair ended. */
  shut_in_hours: number;
  /** Step drops of one truck load while the pump was down. */
  truck_trips_observed: number;
  /** Implied cost of what happened: observed trips × cost_per_trip + lost production of every shut-in well. */
  actual_cost: number;
  recommended_cost: number | null;
  recommended_label: string | null;
  /** actual − recommended; null when no plan was attached. */
  cost_delta: number | null;
}

export interface ResolutionOutcome extends OutcomeBase {
  category: "pipeline_leak" | "pump_degradation";
  time_to_resolution_hours: number;
}

export type Outcome = PumpFailureOutcome | ResolutionOutcome;

const r2 = (x: number) => Math.round(x * 100) / 100;

/** One outcome per resolved event in `analysis.events`, in event order. Ongoing events are skipped. */
export function deriveOutcomes(ds: Dataset, analysis: Analysis): Outcome[] {
  const facilities = new Map<string, Facility>();
  for (const s of ds.network.systems) for (const f of s.facilities) facilities.set(f.id, f);
  const out: Outcome[] = [];
  for (const e of analysis.events) {
    if (e.status !== "resolved" || e.end_unix === null) continue;
    const base: OutcomeBase = { event_id: e.id, folder: ds.folder, system: e.system, facility: e.facility, asset: e.asset, onset_unix: e.onset_unix, end_unix: e.end_unix, confidence: e.confidence };
    if (e.category !== "pump_failure") {
      out.push({ ...base, category: e.category, time_to_resolution_hours: r2((e.end_unix - e.onset_unix) / 3600) });
      continue;
    }
    const fac = facilities.get(e.facility);
    if (fac) out.push({ ...base, category: "pump_failure", ...pumpFailure(ds, fac, e, e.end_unix) });
  }
  return out;
}

function pumpFailure(ds: Dataset, fac: Facility, e: Event, end: number): Omit<PumpFailureOutcome, keyof OutcomeBase | "category"> {
  const { ts } = ds;
  const get = (asset: string, metric: string) => ds.series.get(seriesKey(asset, metric));
  const level = get(fac.tank.id, "level_pct");
  const pump = get(fac.pump.id, "status");
  const wells = fac.wells.map((w) => ({ w, status: get(w.id, "status"), hours: 0 }));
  const shutdown = ds.network.defaults.tank_limits_pct.shutdown;
  const dtH = (ts.length > 1 ? ts[1] - ts[0] : 300) / 3600;
  const { prices, emergency_trucking: trucking } = ds.ops;
  const lostPerHr = (w: Well) => (w.oil_bpd * prices.oil_per_bbl + w.gas_mcfd * prices.gas_per_mcf) / 24;
  const tripPct = (trucking.truck_capacity_bbl / fac.tank.capacity_bbl) * 100;

  let peak = -Infinity;
  let trippedAt: number | null = null;
  let trips = 0;
  let i = ts.findIndex((t) => t >= e.onset_unix);
  if (i < 0) i = ts.length;
  for (const i0 = i; i < ts.length && ts[i] <= end; i++) {
    const lv = level?.[i] ?? NaN;
    if (lv > peak) peak = lv;
    const allShut = wells.length > 0 && wells.every((x) => x.status?.[i] === 0);
    // Automatic shut-in: every well off while the tank sits at the shutdown limit (level noise is ±0.15 pct).
    if (trippedAt === null && allShut && lv >= shutdown - 0.5) trippedAt = ts[i];
    if (ts[i] < end) for (const x of wells) if (x.status?.[i] === 0) x.hours += dtH;
    // A truck trip is the only thing that drops a tank by a whole load in one step while the pump is down.
    if (i > i0 && pump?.[i - 1] === 2 && lv - (level?.[i - 1] ?? NaN) < -0.5 * tripPct) trips++;
  }
  const shutInCost = wells.reduce((s, x) => s + lostPerHr(x.w) * x.hours, 0);
  const actual = r2(trips * trucking.cost_per_trip + shutInCost);
  const recommended = e.plan?.recommended ?? null;
  return {
    peak_level_pct: Number.isFinite(peak) ? r2(peak) : NaN,
    tripped: trippedAt !== null,
    tripped_at_unix: trippedAt,
    shut_in_hours: r2(wells.reduce((m, x) => Math.max(m, x.hours), 0)),
    truck_trips_observed: trips,
    actual_cost: actual,
    recommended_cost: recommended ? r2(recommended.cost) : null,
    recommended_label: recommended?.label ?? null,
    cost_delta: recommended ? r2(actual - recommended.cost) : null,
  };
}
