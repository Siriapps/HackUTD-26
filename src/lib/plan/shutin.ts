import type { Ops, Well } from "../data/types";
import { simulateTank, type TankSimInput, type TankSimResult } from "./tank";

/** Lost production value of one well while shut in, $/h. */
export function lostPerHr(well: Well, prices: Ops["prices"]): number {
  return (well.oil_bpd * prices.oil_per_bbl + well.gas_mcfd * prices.gas_per_mcf) / 24;
}

/**
 * Latest integer minute at which shutting in `wells` still keeps the tank strictly below
 * shutdown through the horizon (given the base plan's trucks). Feasibility is monotone in the
 * start minute, so binary search. Null when even an immediate shut-in trips.
 */
export function latestShutIn(base: TankSimInput, wells: string[]): { afterMin: number; sim: TankSimResult } | null {
  const run = (afterMin: number) => simulateTank({ ...base, shutIn: { wells, afterMin } });
  const M = Math.max(0, Math.round((base.horizonEndUnix - base.startUnix) / 60));
  let lo = 0;
  let loSim = run(0);
  if (!loSim.feasible) return null;
  let hi = M;
  if (run(hi).feasible) return { afterMin: hi, sim: run(hi) }; // never needed, but latest = horizon
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const s = run(mid);
    if (s.feasible) {
      lo = mid;
      loSim = s;
    } else hi = mid;
  }
  return { afterMin: lo, sim: loSim };
}
