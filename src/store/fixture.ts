/**
 * Hand-written stand-in for W1's `analyse()`: the snapshot_2026-10-08T1200 situation (three S2 pump failures
 * sharing two trucks, a leak on S5_PIPELINE_B, two worn pumps) plus the resolved history before it, so the
 * timeline has something to draw. Reference numbers from docs/PLAN.md: E11 1 truck $905 (htl 1.42),
 * E12 shut in S2_WELL_C1 at +46 min $1,298 (htl 2.33), E13 1 truck $905 (htl 2.58); E9 $905 / $1,958 / $5,016.
 *
 * Only used while analyse() returns no events (see store/index.ts). Times are anchored to the loaded folder's
 * own "now" so the picture survives folder switches; facilities missing from a folder are skipped.
 * Set FIXTURE_ENABLED = false (or delete this file) once W1 lands.
 */
import type {
  Action,
  Analysis,
  Category,
  Dataset,
  DegradationForecast,
  Event,
  Facility,
  LevelPoint,
  Plan,
  PlanOption,
  System,
} from "@/lib/data/types";
import { fmtClock } from "@/components/format";
import { describeActions } from "@/lib/export/handoff";

export const FIXTURE_ENABLED = true;

const H = 3600;

interface Scenario {
  id: string;
  facility: string;
  asset: string;
  category: Category;
  onsetH: number; // hours relative to the folder's now (negative = past)
  endH: number | null;
  confidence: number;
  /** pump failures: tank level at plan start (now for ongoing, onset for resolved) */
  level?: number;
  /** pump failures: options to show, recommended first; costs are derived from the dataset's ops numbers */
  options?: [string, Action[]][];
  /** leaks / worn pumps: observed ratio (receive/pump or flow/max) and pressure change */
  ratio?: number;
  psi?: number;
}

const SCENARIO: Scenario[] = [
  { id: "EV-0001", facility: "S3_FACILITY_B", asset: "S3_PIPELINE_B", category: "pipeline_leak", onsetH: -78, endH: -52, confidence: 0.86, ratio: 0.9, psi: -30 },
  { id: "EV-0002", facility: "S5_FACILITY_A", asset: "S5_PUMP_A", category: "pump_degradation", onsetH: -72, endH: -44, confidence: 0.88, ratio: 0.85, psi: -10 },
  { id: "EV-0003", facility: "S2_FACILITY_A", asset: "S2_PUMP_A", category: "pump_degradation", onsetH: -64, endH: -40, confidence: 0.9, ratio: 0.85, psi: -10 },
  { id: "EV-0004", facility: "S4_FACILITY_A", asset: "S4_PIPELINE_A", category: "pipeline_leak", onsetH: -58, endH: -30, confidence: 0.87, ratio: 0.9, psi: -31 },
  { id: "EV-0005", facility: "S1_FACILITY_C", asset: "S1_PUMP_C", category: "pump_degradation", onsetH: -48, endH: -11.67, confidence: 0.91, ratio: 0.85, psi: -11 },
  {
    id: "EV-0006", facility: "S1_FACILITY_B", asset: "S1_PUMP_B", category: "pump_failure", onsetH: -33.83, endH: -27.83, confidence: 0.99, level: 35,
    options: [
      ["No action: peaks below shutdown", [{ type: "none" }]],
      ["1 truck, 1 trip", [{ type: "dispatch_truck", facility_id: "S1_FACILITY_B", trucks: 1, trips_per_truck: 1 }]],
    ],
  },
  { id: "EV-0007", facility: "S3_FACILITY_A", asset: "S3_PUMP_A", category: "pump_degradation", onsetH: -28, endH: null, confidence: 0.9, ratio: 0.909, psi: -45 },
  { id: "EV-0008", facility: "S4_FACILITY_C", asset: "S4_PUMP_C", category: "pump_degradation", onsetH: -22, endH: null, confidence: 0.87, ratio: 0.912, psi: -38 },
  {
    id: "EV-0009", facility: "S1_FACILITY_C", asset: "S1_PUMP_C", category: "pump_failure", onsetH: -11.67, endH: -5.67, confidence: 0.99, level: 50,
    options: [
      ["1 truck, 1 trip", [{ type: "dispatch_truck", facility_id: "S1_FACILITY_C", trucks: 1, trips_per_truck: 1 }]],
      ["Shut in S1_WELL_C2 at +125 min", [{ type: "shut_in_wells", wells: ["S1_WELL_C2"], start_after_min: 125 }]],
      ["1 truck, 2 trips", [{ type: "dispatch_truck", facility_id: "S1_FACILITY_C", trucks: 1, trips_per_truck: 2 }]],
      ["Do nothing: accept the trip", [{ type: "none" }]],
    ],
  },
  { id: "EV-0010", facility: "S5_FACILITY_B", asset: "S5_PIPELINE_B", category: "pipeline_leak", onsetH: -6, endH: null, confidence: 0.84, ratio: 0.96, psi: -31 },
  {
    id: "EV-0011", facility: "S2_FACILITY_B", asset: "S2_PUMP_B", category: "pump_failure", onsetH: -3, endH: null, confidence: 0.99, level: 78.6,
    options: [
      ["1 truck, 1 trip", [{ type: "dispatch_truck", facility_id: "S2_FACILITY_B", trucks: 1, trips_per_truck: 1 }]],
      ["2 trucks, 1 trip", [{ type: "dispatch_truck", facility_id: "S2_FACILITY_B", trucks: 2, trips_per_truck: 1 }]],
      ["Shut in S2_WELL_B1 + S2_WELL_B2 at +36 min", [{ type: "shut_in_wells", wells: ["S2_WELL_B1", "S2_WELL_B2"], start_after_min: 36 }]],
      ["Shut in S2_WELL_B2 now", [{ type: "shut_in_wells", wells: ["S2_WELL_B2"], start_after_min: 0 }]],
      ["Do nothing: accept the trip", [{ type: "none" }]],
    ],
  },
  {
    id: "EV-0012", facility: "S2_FACILITY_C", asset: "S2_PUMP_C", category: "pump_failure", onsetH: -2.5, endH: null, confidence: 0.99, level: 69.3,
    options: [
      ["Shut in S2_WELL_C1 at +46 min", [{ type: "shut_in_wells", wells: ["S2_WELL_C1"], start_after_min: 46 }]],
      ["Shut in S2_WELL_C1 + S2_WELL_C2 at +117 min", [{ type: "shut_in_wells", wells: ["S2_WELL_C1", "S2_WELL_C2"], start_after_min: 117 }]],
      ["1 truck, 1 trip (no truck free: both committed)", [{ type: "dispatch_truck", facility_id: "S2_FACILITY_C", trucks: 1, trips_per_truck: 1 }]],
      ["Do nothing: accept the trip", [{ type: "none" }]],
    ],
  },
  {
    id: "EV-0013", facility: "S2_FACILITY_A", asset: "S2_PUMP_A", category: "pump_failure", onsetH: -2, endH: null, confidence: 0.99, level: 68.3,
    options: [
      ["1 truck, 1 trip", [{ type: "dispatch_truck", facility_id: "S2_FACILITY_A", trucks: 1, trips_per_truck: 1 }]],
      ["2 trucks, 1 trip", [{ type: "dispatch_truck", facility_id: "S2_FACILITY_A", trucks: 2, trips_per_truck: 1 }]],
      ["Shut in S2_WELL_A1 at +70 min", [{ type: "shut_in_wells", wells: ["S2_WELL_A1"], start_after_min: 70 }]],
      ["Do nothing: accept the trip", [{ type: "none" }]],
    ],
  },
];

/** The scenario is pinned to the showcase folder's clock; other folders get it re-anchored to their own now. */
export function fixtureAnalysis(ds: Dataset, now: number): Analysis | null {
  const anchor = ds.now;
  const shutdown = ds.network.defaults.tank_limits_pct.shutdown;
  const warning = ds.network.defaults.tank_limits_pct.warning;
  const repairH = ds.ops.expected_repair_hours.pump_failure;
  const index = new Map<string, { facility: Facility; system: System }>();
  for (const system of ds.network.systems) for (const facility of system.facilities) index.set(facility.id, { facility, system });

  const events: Event[] = [];
  for (const s of SCENARIO) {
    const ref = index.get(s.facility);
    if (!ref) continue;
    const onset = Math.round(anchor + s.onsetH * H);
    if (onset > now) continue;
    const trueEnd = s.endH == null ? null : Math.round(anchor + s.endH * H);
    const ongoing = trueEnd == null || trueEnd > now;
    const base: Event = {
      id: s.id,
      system: ref.system.id,
      facility: s.facility,
      asset: s.asset,
      category: s.category,
      onset_unix: onset,
      end_unix: ongoing ? null : trueEnd,
      status: ongoing ? "ongoing" : "resolved",
      confidence: s.confidence,
      evidence: [],
      actions: [],
    };
    if (s.category === "pump_failure") events.push(failure(ds, ref, base, s, ongoing ? now : onset, shutdown, warning, repairH));
    else events.push(inspection(ds, ref, base, s, now));
  }
  if (!events.length) return null;

  const ongoing = events.filter((e) => e.status === "ongoing");
  const alerts = [
    ...ongoing
      .filter((e) => e.category === "pump_failure")
      .sort(
        (a, b) =>
          (a.hours_to_limit?.p50 ?? Infinity) - (b.hours_to_limit?.p50 ?? Infinity) ||
          (b.lost_revenue_per_hr ?? 0) - (a.lost_revenue_per_hr ?? 0),
      ),
    ...ongoing.filter((e) => e.category !== "pump_failure").sort((a, b) => a.onset_unix - b.onset_unix),
  ];

  const fleet: Analysis["fleet"] = {};
  for (const [sysId, sys] of Object.entries(ds.ops.systems)) fleet[sysId] = { size: sys.emergency_fleet_size, committed: 0 };
  for (const e of ongoing) if (e.plan && fleet[e.system]) fleet[e.system].committed += e.plan.trucks_used;

  const forecasts: DegradationForecast[] = ongoing
    .filter((e) => e.category === "pump_degradation")
    .map((e) => {
      const s = SCENARIO.find((x) => x.id === e.id)!;
      const ref = index.get(e.facility)!;
      const hours = Math.max(1, (now - e.onset_unix) / H);
      const slope = -(1 - (s.ratio ?? 0.9)) / hours;
      const inflowRatio = baselineInflow(ref.facility) / ref.facility.pump.max_flow_bpd;
      const ratio = s.ratio ?? 0.9;
      return {
        pump_id: e.asset,
        facility: e.facility,
        slope_per_hr: slope,
        cannot_drain_unix: ratio > inflowRatio ? Math.round(now + ((ratio - inflowRatio) / -slope) * H) : now,
        predicted_fail_unix: ratio > 0.85 ? Math.round(now + ((ratio - 0.85) / -slope) * H) : now,
        confidence: e.confidence,
      };
    });

  return { folder: ds.folder, now, events, alerts, forecasts, fleet };
}

// ─── pump failures ────────────────────────────────────────────────────────

function failure(
  ds: Dataset,
  ref: { facility: Facility; system: System },
  base: Event,
  s: Scenario,
  planStart: number,
  shutdown: number,
  warning: number,
  repairH: number,
): Event {
  const { facility, system } = ref;
  const level = s.level ?? 50;
  const inflow = baselineInflow(facility);
  const rate = (inflow / 24 / facility.tank.capacity_bbl) * 100; // pct points per hour
  const horizonEnd = base.onset_unix + repairH * H;
  const options = (s.options ?? []).map(([label, actions]) =>
    option(ds, facility, system, label, actions, { level0: level, start: planStart, end: horizonEnd, shutdown }),
  );
  const [recommended, ...rest] = options;
  const plan: Plan = {
    recommended,
    alternatives: rest.sort((a, b) => a.cost - b.cost),
    trucks_used: recommended.actions.reduce((n, a) => (a.type === "dispatch_truck" ? n + a.trucks : n), 0),
    horizon_end_unix: horizonEnd,
  };
  const htl = Math.max(0, (shutdown - level) / rate);
  const disposal = system.disposal_site.pressure_psi;
  return {
    ...base,
    level_pct: level,
    hours_to_limit: { p10: round(htl * 0.93, 2), p50: round(htl, 2), p90: round(htl * 1.07, 2) },
    hours_to_warning: level < warning ? round((warning - level) / rate, 2) : 0,
    trips_at_unix: Math.round(planStart + htl * H),
    lost_revenue_per_hr: round(lostPerHr(ds, facility), 2),
    plan,
    actions: recommended.actions,
    evidence: [
      `Pump status 2 (fault) since ${fmtClock(base.onset_unix)}; flow 0 bpd`,
      `Discharge sits at disposal pressure (${disposal} psi): the pump is not moving water`,
      `Tank at ${level.toFixed(1)}% and rising ${rate.toFixed(1)} pts/h on ${Math.round(inflow)} bpd inflow`,
    ],
  };
}

function option(
  ds: Dataset,
  facility: Facility,
  system: System,
  label: string,
  actions: Action[],
  base: { level0: number; start: number; end: number; shutdown: number },
): PlanOption {
  const opsF = ds.ops.systems[system.id]?.facilities[facility.id];
  const { truck_capacity_bbl, cost_per_trip } = ds.ops.emergency_trucking;
  const trucks: { at: number; bbl: number }[] = [];
  const shutins: { at: number; bpd: number }[] = [];
  let cost = 0;
  for (const a of actions) {
    if (a.type === "dispatch_truck" && opsF) {
      for (let k = 0; k < a.trips_per_truck; k++) {
        const at = base.start + (opsF.response_min + k * opsF.cycle_min) * 60;
        if (at < base.end) trucks.push({ at, bbl: a.trucks * truck_capacity_bbl });
      }
      cost += a.trucks * a.trips_per_truck * cost_per_trip;
    }
    if (a.type === "shut_in_wells") {
      const at = base.start + a.start_after_min * 60;
      shutins.push({ at, bpd: baselineInflow(facility, a.wells) });
      cost += (lostPerHr(ds, facility, a.wells) * (base.end - at)) / H;
    }
  }
  const sim = project({ ...base, inflow: baselineInflow(facility), capacity: facility.tank.capacity_bbl, trucks, shutins });
  const feasible = sim.trips_at == null;
  if (sim.trips_at != null) cost += (lostPerHr(ds, facility) * (base.end - sim.trips_at)) / H; // automatic shut-in until repair ends
  return {
    label: label || describeActions(actions),
    actions,
    cost: Math.round(cost),
    feasible,
    peak_level_pct: sim.peak,
    trips_at_unix: sim.trips_at == null ? null : Math.round(sim.trips_at),
    curve: sim.curve,
  };
}

/** 5-minute tank projection: inflow minus truck pickups, held at shutdown once it trips. */
function project(p: {
  level0: number;
  inflow: number;
  capacity: number;
  start: number;
  end: number;
  shutdown: number;
  trucks: { at: number; bbl: number }[];
  shutins: { at: number; bpd: number }[];
}): { curve: LevelPoint[]; peak: number; trips_at: number | null } {
  const curve: LevelPoint[] = [];
  let level = p.level0;
  let peak = level;
  let trips: number | null = null;
  for (let t = p.start; t <= p.end; t += 300) {
    if (t > p.start && trips == null) {
      const inflow = p.inflow - p.shutins.filter((s) => s.at <= t).reduce((n, s) => n + s.bpd, 0);
      const prev = level;
      level += (inflow / 24 / p.capacity) * 100 * (300 / H);
      for (const tr of p.trucks) if (tr.at > t - 300 && tr.at <= t) level = Math.max(0, level - (tr.bbl / p.capacity) * 100);
      if (level >= p.shutdown) {
        trips = t - 300 + 300 * ((p.shutdown - prev) / Math.max(1e-9, level - prev));
        level = p.shutdown;
      }
    }
    peak = Math.max(peak, level);
    curve.push({ t_unix: t, level_pct: round(level, 2) });
  }
  return { curve, peak: round(peak, 1), trips_at: trips };
}

// ─── leaks and worn pumps ─────────────────────────────────────────────────

function inspection(ds: Dataset, ref: { facility: Facility; system: System }, base: Event, s: Scenario, now: number): Event {
  const { facility, system } = ref;
  const hours = Math.max(1, Math.round(((base.end_unix ?? now) - base.onset_unix) / H));
  const ratio = s.ratio ?? 0.95;
  const pct = ((1 - ratio) * 100).toFixed(1);
  const evidence =
    s.category === "pipeline_leak"
      ? [
          `Receive flow is ${pct}% below pump flow for ${hours} h (healthy ratio 1.000 ± 0.002)`,
          `Pipeline pressure ${Math.abs(s.psi ?? 30)} psi below the running baseline of ${system.disposal_site.pressure_psi + 50} psi`,
          `Discharge pressure unchanged, so the pump itself is healthy`,
        ]
      : [
          `Running flow ${Math.round(facility.pump.max_flow_bpd * ratio).toLocaleString("en-US")} bpd is ${pct}% below max_flow ${facility.pump.max_flow_bpd.toLocaleString("en-US")} bpd`,
          `Discharge pressure sagging ${Math.abs(s.psi ?? 10)} psi while running`,
          `Receive/pump ratio still 1.00: the pipeline is intact, the pump is wearing`,
        ];
  return { ...base, evidence, actions: [{ type: "field_inspection", asset_id: s.asset }] };
}

// ─── shared arithmetic (dataset numbers only) ─────────────────────────────

function baselineInflow(f: Facility, only?: string[]): number {
  return f.wells.filter((w) => !only || only.includes(w.id)).reduce((n, w) => n + w.baseline_water_bpd, 0);
}
function lostPerHr(ds: Dataset, f: Facility, only?: string[]): number {
  const { oil_per_bbl, gas_per_mcf } = ds.ops.prices;
  return f.wells
    .filter((w) => !only || only.includes(w.id))
    .reduce((n, w) => n + (w.oil_bpd * oil_per_bbl + w.gas_mcfd * gas_per_mcf) / 24, 0);
}
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
