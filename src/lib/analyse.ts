import type { Analysis, Dataset, Event } from "./data/types";
import { detectEvents, facilityContexts, lastIndexLE, type FacilityCtx } from "./detect/events";
import { countdown, producingWells } from "./forecast/countdown";
import { forecastDegradation } from "./forecast/degradation";
import { FleetLedger } from "./plan/ledger";
import { facilityOptions, makePlan, planJointly, type FacilityPlanInput } from "./plan/optimise";
import { busyUntilUnix } from "./plan/trucks";

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

  const ledger = new FleetLedger();
  const pending: { e: Event; inp: FacilityPlanInput }[] = [];

  for (const e of events) {
    if (e.category !== "pump_failure") continue;
    const ctx = byFacility.get(e.facility)!;
    const onsetIdx = lastIndexLE(dataset.ts, e.onset_unix);
    const ongoing = e.status === "ongoing";
    const atIdx = ongoing ? nowIdx : onsetIdx;
    const repairEnd = e.onset_unix + repairH * 3600;
    // Resolved events are planned at onset; anchor the level on the whole observed climb.
    const endIdx = e.end_unix === null ? nowIdx : lastIndexLE(dataset.ts, e.end_unix);
    const cd = countdown(dataset, ctx, onsetIdx, atIdx, ongoing ? nowIdx : Math.min(nowIdx, endIdx), repairEnd);
    e.level_pct = Math.round(cd.level_pct * 100) / 100;
    e.hours_to_limit = ongoing ? cd.hours_to_limit : null;
    e.hours_to_warning = ongoing ? cd.hours_to_warning : null;
    e.trips_at_unix = cd.trips_at_unix;
    e.lost_revenue_per_hr = lostRevenuePerHr(dataset, ctx);
    const fleetSize = dataset.ops.systems[e.system]?.emergency_fleet_size ?? 0;
    const inp: FacilityPlanInput = {
      ds: dataset,
      ctx,
      startUnix: dataset.ts[atIdx],
      horizonEndUnix: repairEnd,
      level0: cd.level_pct,
      producing: producingWells(ctx, onsetIdx),
      freeTrucks: fleetSize,
      tripped: cd.tripped,
      trippedAtUnix: cd.tripped ? cd.trips_at_unix : null,
    };
    if (ongoing) {
      // SPEC: at "now" nothing has been dispatched; all ongoing failures in a system share the whole fleet.
      pending.push({ e, inp });
      continue;
    }
    // Historical replay: earlier recommended plans were followed, so their trucks may still be busy.
    const free = ledger.freeAt(e.system, fleetSize, e.onset_unix);
    e.plan = makePlan(facilityOptions({ ...inp, freeTrucks: free }), free, repairEnd);
    e.actions = e.plan.recommended.actions;
    e.evidence.push(`${free} of ${fleetSize} trucks free at onset`);
    const timing = dataset.ops.systems[e.system]?.facilities[e.facility];
    if (timing) {
      const busy: number[] = [];
      for (const a of e.plan.recommended.actions)
        if (a.type === "dispatch_truck") for (let k = 0; k < a.trucks; k++) busy.push(busyUntilUnix(e.onset_unix, timing.response_min, timing.cycle_min, a.trips_per_truck));
      ledger.commit(e.system, busy);
    }
  }

  const fleet: Analysis["fleet"] = {};
  for (const sys of dataset.network.systems) fleet[sys.id] = { size: dataset.ops.systems[sys.id]?.emergency_fleet_size ?? 0, committed: 0 };
  const bySystem = new Map<string, typeof pending>();
  for (const p of pending) bySystem.set(p.e.system, [...(bySystem.get(p.e.system) ?? []), p]);
  for (const [sys, group] of bySystem) {
    const size = fleet[sys]?.size ?? 0;
    const { plans, committed } = planJointly(group.map((g) => g.inp), size);
    group.forEach((g, i) => {
      g.e.plan = plans[i];
      g.e.actions = plans[i].recommended.actions;
      g.e.evidence.push(group.length > 1 ? `${plans[i].trucks_used} of ${size} trucks allocated (shared with ${group.length - 1} other failure${group.length > 2 ? "s" : ""} in ${sys})` : `${plans[i].trucks_used} of ${size} trucks used`);
    });
    if (fleet[sys]) fleet[sys].committed = committed;
  }

  const alerts = events.filter((e) => e.status === "ongoing").sort(alertOrder);
  return { folder: dataset.folder, now, events, alerts, forecasts: forecastDegradation(dataset, events, now), fleet };
}
