import { seriesKey, type Analysis, type Dataset, type Plan } from "../data/types";
import { facilityContexts, lastIndexLE } from "../detect/events";
import { planJointly, type FacilityPlanInput } from "../plan/optimise";
import { producingWells } from "./countdown";

export interface WhatIfScenario {
  system: string;
  /** Facilities whose pump additionally fails at "now" (tank starts from its current reading). */
  extraFailures?: string[];
  /** Change to the system's truck fleet, e.g. -1. */
  fleetDelta?: number;
  /** Disposal site down: every facility in the system stops pumping at "now". */
  disposalDown?: boolean;
}

export interface WhatIfResult {
  system: string;
  fleet: number;
  committed: number;
  total_cost: number;
  /** Per facility: the plan under the scenario and whether this failure is hypothetical. */
  facilities: { facility: string; hypothetical: boolean; plan: Plan }[];
}

/**
 * Fleet-stress what-if: re-plan a system at "now" with extra failures and/or a different fleet.
 * Ongoing failures are re-planned from their current state; hypothetical ones start at the
 * current tank reading with a full repair horizon. Pure: never mutates `analysis`.
 */
export function whatIf(ds: Dataset, analysis: Analysis, sc: WhatIfScenario): WhatIfResult {
  const now = analysis.now;
  const nowIdx = lastIndexLE(ds.ts, now);
  const repairH = ds.ops.expected_repair_hours.pump_failure;
  const ctxs = facilityContexts(ds).filter((c) => c.sys.id === sc.system);
  const ongoing = new Map(analysis.alerts.filter((e) => e.category === "pump_failure" && e.system === sc.system).map((e) => [e.facility, e]));
  const extra = new Set(sc.disposalDown ? ctxs.map((c) => c.fac.id) : (sc.extraFailures ?? []));
  const inputs: FacilityPlanInput[] = [];
  const meta: { facility: string; hypothetical: boolean }[] = [];
  const fleet = Math.max(0, (ds.ops.systems[sc.system]?.emergency_fleet_size ?? 0) + (sc.fleetDelta ?? 0));
  const shutdown = ds.network.defaults.tank_limits_pct.shutdown;

  for (const ctx of ctxs) {
    const e = ongoing.get(ctx.fac.id);
    if (e) {
      const onsetIdx = lastIndexLE(ds.ts, e.onset_unix);
      inputs.push({
        ds,
        ctx,
        startUnix: now,
        horizonEndUnix: e.onset_unix + repairH * 3600,
        level0: e.level_pct ?? ctx.lv[nowIdx],
        producing: producingWells(ctx, onsetIdx),
        freeTrucks: fleet,
        tripped: (e.hours_to_limit?.p50 ?? 1) <= 0,
        trippedAtUnix: e.trips_at_unix ?? null,
      });
      meta.push({ facility: ctx.fac.id, hypothetical: false });
    } else if (extra.has(ctx.fac.id)) {
      const level = ds.series.get(seriesKey(ctx.fac.tank.id, "level_pct"))?.[nowIdx] ?? 0;
      inputs.push({
        ds,
        ctx,
        startUnix: now,
        horizonEndUnix: now + repairH * 3600,
        level0: Math.min(level, shutdown),
        producing: producingWells(ctx, nowIdx),
        freeTrucks: fleet,
        tripped: level >= shutdown,
        trippedAtUnix: level >= shutdown ? now : null,
      });
      meta.push({ facility: ctx.fac.id, hypothetical: true });
    }
  }
  if (!inputs.length) return { system: sc.system, fleet, committed: 0, total_cost: 0, facilities: [] };
  const { plans, committed } = planJointly(inputs, fleet);
  return {
    system: sc.system,
    fleet,
    committed,
    total_cost: plans.reduce((s, p) => s + p.recommended.cost, 0),
    facilities: meta.map((m, i) => ({ ...m, plan: plans[i] })),
  };
}
