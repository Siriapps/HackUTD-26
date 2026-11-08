import type { Action, Dataset, Plan, PlanOption, Well } from "../data/types";
import type { FacilityCtx } from "../detect/events";
import { fmtT } from "../detect/events";
import { latestShutIn, lostPerHr } from "./shutin";
import { simulateTank, type TankSimInput, type TankSimResult } from "./tank";
import { arrivalsMin, maxTrips } from "./trucks";

export interface FacilityPlanInput {
  ds: Dataset;
  ctx: FacilityCtx;
  /** Plan start (now for ongoing, onset for resolved). */
  startUnix: number;
  /** Repair end. */
  horizonEndUnix: number;
  /** Anchored tank level at `startUnix`. */
  level0: number;
  /** Wells producing at onset. */
  producing: Well[];
  /** Trucks this facility may use. */
  freeTrucks: number;
  /** Tank already at shutdown at plan start. */
  tripped?: boolean;
  trippedAtUnix?: number | null;
}

const fmt$ = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Number of trucks an option dispatches. */
export function trucksOf(o: PlanOption): number {
  return o.actions.reduce((s, a) => (a.type === "dispatch_truck" ? s + a.trucks : s), 0);
}
function tripsOf(o: PlanOption): number {
  return o.actions.reduce((s, a) => (a.type === "dispatch_truck" ? s + a.trucks * a.trips_per_truck : s), 0);
}
function wellsOf(o: PlanOption): number {
  return o.actions.reduce((s, a) => (a.type === "shut_in_wells" ? s + a.wells.length : s), 0);
}

function nonEmptySubsets<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let mask = 1; mask < 1 << items.length; mask++) out.push(items.filter((_, i) => mask & (1 << i)));
  return out;
}

/** Every option for one pump failure, cheapest first. */
export function facilityOptions(inp: FacilityPlanInput): PlanOption[] {
  const { ds, ctx, startUnix, horizonEndUnix, level0, producing, freeTrucks } = inp;
  const prices = ds.ops.prices;
  const shutdown = ds.network.defaults.tank_limits_pct.shutdown;
  const { truck_capacity_bbl, cost_per_trip } = ds.ops.emergency_trucking;
  const timing = ds.ops.systems[ctx.sys.id]?.facilities[ctx.fac.id];
  const M = Math.max(0, Math.round((horizonEndUnix - startUnix) / 60));
  const lostAll = producing.reduce((s, w) => s + lostPerHr(w, prices), 0);
  const lostOf = (ids: string[]) => producing.filter((w) => ids.includes(w.id)).reduce((s, w) => s + lostPerHr(w, prices), 0);
  const hoursAfterTrip = (sim: TankSimResult) => (sim.tripsAtUnix === null ? 0 : (horizonEndUnix - sim.tripsAtUnix) / 3600);

  if (inp.tripped) {
    const trippedAt = inp.trippedAtUnix ?? startUnix;
    const hours = Math.max(0, (horizonEndUnix - trippedAt) / 3600);
    return [
      {
        label: `Already tripped at ${fmtT(trippedAt)} UTC; wells shut in until repair (${fmt$(lostAll * hours)} lost)`,
        actions: [{ type: "none" }],
        cost: lostAll * hours,
        feasible: false,
        peak_level_pct: shutdown,
        trips_at_unix: trippedAt,
        curve: [
          { t_unix: startUnix, level_pct: shutdown },
          { t_unix: horizonEndUnix, level_pct: shutdown },
        ],
      },
    ];
  }

  const base: TankSimInput = {
    startUnix,
    horizonEndUnix,
    level0,
    capacityBbl: ctx.fac.tank.capacity_bbl,
    shutdownPct: shutdown,
    wells: producing.map((w) => ({ id: w.id, bpd: w.baseline_water_bpd })),
    truckBbl: truck_capacity_bbl,
  };
  const opt = (label: string, actions: Action[], sim: TankSimResult, directCost: number): PlanOption => ({
    label,
    actions,
    cost: directCost + (sim.feasible ? 0 : lostAll * hoursAfterTrip(sim)),
    feasible: sim.feasible,
    peak_level_pct: sim.peak,
    trips_at_unix: sim.tripsAtUnix === null ? null : Math.round(sim.tripsAtUnix),
    curve: sim.curve,
  });
  const options: PlanOption[] = [];

  // Do nothing.
  const nothing = simulateTank(base);
  options.push(
    nothing.feasible
      ? opt(`No action needed (peaks ${nothing.peak.toFixed(1)} %)`, [{ type: "none" }], nothing, 0)
      : opt(`Accept the trip at ${fmtT(nothing.tripsAtUnix!)} UTC`, [{ type: "none" }], nothing, 0),
  );
  if (nothing.feasible) return options;

  const subsets = nonEmptySubsets(producing);
  const shutLabel = (ids: string[], at: number) => `Shut in ${ids.join(", ")} at +${at} min`;
  const shutCost = (ids: string[], at: number) => (lostOf(ids) * (M - at)) / 60;

  // Shut-ins alone.
  for (const sub of subsets) {
    const ids = sub.map((w) => w.id);
    const r = latestShutIn(base, ids);
    if (!r) continue;
    options.push(opt(shutLabel(ids, r.afterMin), [{ type: "shut_in_wells", wells: ids, start_after_min: r.afterMin }], r.sim, shutCost(ids, r.afterMin)));
  }

  // Trucks, and trucks + shut-in when trucks alone still trip.
  if (timing && freeTrucks > 0) {
    const perTruck = maxTrips(timing.response_min, timing.cycle_min, M);
    for (let k = 1; k <= freeTrucks; k++) {
      for (let m = 1; m <= perTruck; m++) {
        const arr = arrivalsMin(timing.response_min, timing.cycle_min, m);
        const arrivals = Array.from({ length: k }, () => arr).flat();
        const withTrucks: TankSimInput = { ...base, arrivalsMin: arrivals };
        const sim = simulateTank(withTrucks);
        const tl = `${plural(k, "truck")}, ${plural(m, "trip")}${k > 1 ? " each" : ""}`;
        const ta: Action = { type: "dispatch_truck", facility_id: ctx.fac.id, trucks: k, trips_per_truck: m };
        const truckCost = k * m * cost_per_trip;
        options.push(opt(tl, [ta], sim, truckCost));
        if (sim.feasible) continue;
        for (const sub of subsets) {
          const ids = sub.map((w) => w.id);
          const r = latestShutIn(withTrucks, ids);
          if (!r) continue;
          options.push(
            opt(`${tl} + ${shutLabel(ids, r.afterMin).replace("Shut", "shut")}`, [ta, { type: "shut_in_wells", wells: ids, start_after_min: r.afterMin }], r.sim, truckCost + shutCost(ids, r.afterMin)),
          );
        }
      }
    }
  }

  options.sort((a, b) => a.cost - b.cost || trucksOf(a) - trucksOf(b) || tripsOf(a) - tripsOf(b) || wellsOf(a) - wellsOf(b));
  return options;
}

/** Cheapest option using at most `maxTrucks` trucks. */
export function bestOption(opts: PlanOption[], maxTrucks: number): PlanOption {
  return opts.find((o) => trucksOf(o) <= maxTrucks) ?? opts[0];
}

export function makePlan(opts: PlanOption[], maxTrucks: number, horizonEndUnix: number): Plan {
  const recommended = bestOption(opts, maxTrucks);
  return {
    recommended,
    alternatives: opts.filter((o) => o !== recommended && trucksOf(o) <= maxTrucks),
    trucks_used: trucksOf(recommended),
    horizon_end_unix: horizonEndUnix,
  };
}

/**
 * Plan several ongoing failures in one system together: enumerate how many trucks each may
 * use (Σ ≤ fleet), take the cheapest total, tie → fewer trucks. Inputs' `freeTrucks` is ignored;
 * options are enumerated with the whole fleet and then constrained per allocation.
 */
export function planJointly(inputs: FacilityPlanInput[], fleet: number): { plans: Plan[]; committed: number } {
  const opts = inputs.map((inp) => facilityOptions({ ...inp, freeTrucks: fleet }));
  let best: { alloc: number[]; cost: number; trucks: number } | null = null;
  const alloc = new Array<number>(inputs.length).fill(0);
  const walk = (i: number, left: number) => {
    if (i === inputs.length) {
      let cost = 0;
      let trucks = 0;
      for (let j = 0; j < inputs.length; j++) {
        const o = bestOption(opts[j], alloc[j]);
        cost += o.cost;
        trucks += trucksOf(o);
      }
      if (!best || cost < best.cost - 1e-9 || (Math.abs(cost - best.cost) <= 1e-9 && trucks < best.trucks)) best = { alloc: [...alloc], cost, trucks };
      return;
    }
    for (let k = 0; k <= left; k++) {
      alloc[i] = k;
      walk(i + 1, left - k);
    }
  };
  walk(0, fleet);
  const chosen = best!.alloc;
  const plans = inputs.map((inp, j) => makePlan(opts[j], chosen[j], inp.horizonEndUnix));
  return { plans, committed: plans.reduce((s, p) => s + p.trucks_used, 0) };
}
