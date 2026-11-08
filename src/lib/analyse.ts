import type { Analysis, Dataset, Event } from "./data/types";
import { detectEvents, facilityContexts, lastIndexLE, type FacilityCtx } from "./detect/events";
import { countdown } from "./forecast/countdown";

/** Lost production value of a facility when all its wells are shut in, $/h. */
export function lostRevenuePerHr(ds: Dataset, ctx: FacilityCtx): number {
  const { oil_per_bbl, gas_per_mcf } = ds.ops.prices;
  return ctx.fac.wells.reduce((s, w) => s + (w.oil_bpd * oil_per_bbl + w.gas_mcfd * gas_per_mcf) / 24, 0);
}

/** SPEC alert order: failures by soonest shutdown (tie → higher lost $/h), then leaks and wear. */
export function alertOrder(a: Event, b: Event): number {
  const fa = a.category === "pump_failure";
  const fb = b.category === "pump_failure";
  if (fa !== fb) return fa ? -1 : 1;
  if (fa && fb) {
    const d = (a.hours_to_limit?.p50 ?? Infinity) - (b.hours_to_limit?.p50 ?? Infinity);
    if (d !== 0) return d;
    return (b.lost_revenue_per_hr ?? 0) - (a.lost_revenue_per_hr ?? 0);
  }
  return a.onset_unix - b.onset_unix;
}

/**
 * Single entry point for all analytics. Time travel = pass an earlier `nowOverride`; only
 * telemetry at or before it is used.
 */
export function analyse(dataset: Dataset, nowOverride?: number): Analysis {
  const now = nowOverride ?? dataset.now;
  const nowIdx = lastIndexLE(dataset.ts, now);
  const ctxs = facilityContexts(dataset);
  const byFacility = new Map(ctxs.map((c) => [c.fac.id, c]));
  const events = nowIdx < 0 ? [] : detectEvents(dataset, nowIdx, ctxs);
  const repairH = dataset.ops.expected_repair_hours.pump_failure;
  const dt = dataset.ts.length > 1 ? dataset.ts[1] - dataset.ts[0] : 300;
  const perHour = Math.max(1, Math.round(3600 / dt));

  for (const e of events) {
    if (e.category !== "pump_failure") continue;
    const ctx = byFacility.get(e.facility)!;
    const onsetIdx = lastIndexLE(dataset.ts, e.onset_unix);
    const ongoing = e.status === "ongoing";
    const atIdx = ongoing ? nowIdx : onsetIdx;
    const repairEnd = e.onset_unix + repairH * 3600;
    // Resolved events are evaluated at onset; the anchor may use the first hour of the climb.
    const cd = countdown(dataset, ctx, onsetIdx, atIdx, ongoing ? nowIdx : Math.min(nowIdx, onsetIdx + perHour), repairEnd);
    e.level_pct = Math.round(cd.level_pct * 100) / 100;
    e.hours_to_limit = ongoing ? cd.hours_to_limit : null;
    e.hours_to_warning = ongoing ? cd.hours_to_warning : null;
    e.trips_at_unix = cd.trips_at_unix;
    e.lost_revenue_per_hr = lostRevenuePerHr(dataset, ctx);
    // ponytail: optimiser lands in stage 2; until then a failure asks for an inspection.
    e.actions = [{ type: "field_inspection", asset_id: e.asset }];
  }

  const alerts = events.filter((e) => e.status === "ongoing").sort(alertOrder);
  const fleet: Analysis["fleet"] = {};
  for (const sys of dataset.network.systems) fleet[sys.id] = { size: dataset.ops.systems[sys.id]?.emergency_fleet_size ?? 0, committed: 0 };
  return { folder: dataset.folder, now, events, alerts, forecasts: [], fleet };
}
