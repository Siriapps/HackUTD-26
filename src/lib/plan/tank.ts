import type { LevelPoint } from "../data/types";

export interface TankSimInput {
  /** Plan start (unix s). */
  startUnix: number;
  /** Repair end (unix s). Nothing after it matters. */
  horizonEndUnix: number;
  /** Tank level at plan start, pct. */
  level0: number;
  capacityBbl: number;
  shutdownPct: number;
  /** Wells producing at plan start with their planning water rate. */
  wells: { id: string; bpd: number }[];
  /** Shut these wells in from minute `afterMin` (inclusive) until repair ends. */
  shutIn?: { wells: string[]; afterMin: number };
  /** Truck arrival minutes after plan start; each removes `truckBbl` (capped at tank content). */
  arrivalsMin?: number[];
  truckBbl?: number;
}

export interface TankSimResult {
  curve: LevelPoint[];
  /** Highest level reached (= shutdown when it trips). */
  peak: number;
  /** Continuous (interpolated) time the tank reaches shutdown, or null. */
  tripsAtUnix: number | null;
  /** True when the level stays strictly below shutdown through the horizon. */
  feasible: boolean;
  /** Minutes in the horizon. */
  minutes: number;
}

/**
 * Minute-step tank simulation over the repair horizon (SPEC semantics).
 * Per minute m: truck removals scheduled at m are applied first (only while the tank has not
 * tripped), then one minute of inflow from the wells not shut in. If the level would reach
 * `shutdownPct` the crossing time is interpolated, the level clamps there and inflow stops
 * (automatic shut-in). A trip arriving at or after the horizon end is ignored.
 */
export function simulateTank(inp: TankSimInput): TankSimResult {
  const M = Math.max(0, Math.round((inp.horizonEndUnix - inp.startUnix) / 60));
  const pctPerMin = (bpd: number) => (bpd / 24 / 60 / inp.capacityBbl) * 100;
  const shut = new Set(inp.shutIn?.wells ?? []);
  const afterMin = inp.shutIn?.afterMin ?? Infinity;
  const rateAll = pctPerMin(inp.wells.reduce((s, w) => s + w.bpd, 0));
  const rateShut = pctPerMin(inp.wells.filter((w) => !shut.has(w.id)).reduce((s, w) => s + w.bpd, 0));
  const removePct = ((inp.truckBbl ?? 0) / inp.capacityBbl) * 100;
  const arrivals = new Map<number, number>();
  for (const a of inp.arrivalsMin ?? []) {
    const m = Math.round(a);
    if (m >= 0 && m < M) arrivals.set(m, (arrivals.get(m) ?? 0) + 1);
  }

  let level = inp.level0;
  let peak = level;
  let tripsAtUnix: number | null = null;
  const curve: LevelPoint[] = [{ t_unix: inp.startUnix, level_pct: level }];
  const push = (m: number) => curve.push({ t_unix: inp.startUnix + m * 60, level_pct: level });

  for (let m = 0; m < M; m++) {
    const n = arrivals.get(m);
    if (n && tripsAtUnix === null) {
      level = Math.max(0, level - n * removePct);
      push(m);
    }
    if (tripsAtUnix === null) {
      const rate = m >= afterMin ? rateShut : rateAll;
      const next = level + rate;
      if (next >= inp.shutdownPct && rate > 0) {
        const f = (inp.shutdownPct - level) / rate;
        tripsAtUnix = inp.startUnix + (m + f) * 60;
        level = inp.shutdownPct;
        peak = level;
        push(m + 1);
        continue;
      }
      level = next;
      if (level > peak) peak = level;
    }
    if ((m + 1) % 5 === 0 || m + 1 === M) push(m + 1);
  }
  if (M === 0) curve.push({ t_unix: inp.horizonEndUnix, level_pct: level });
  return { curve, peak, tripsAtUnix, feasible: tripsAtUnix === null && peak < inp.shutdownPct, minutes: M };
}
