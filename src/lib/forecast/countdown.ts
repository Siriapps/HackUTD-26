import type { Dataset, HoursToLimit } from "../data/types";
import type { FacilityCtx } from "../detect/events";
import { mean, stdev } from "../detect/stats";

export interface Countdown {
  /** Best estimate of the true tank level at `atIdx` (regression over the climb, not one noisy reading). */
  level_pct: number;
  /** Planning fill rate from the producing wells' baselines, pct/h. */
  plan_rate_pct_per_hr: number;
  /** Observed fill rate from the last hour of facility inflow, pct/h. */
  rate_pct_per_hr: number;
  hours_to_limit: HoursToLimit;
  hours_to_warning: number | null;
  /** When the tank reaches shutdown if nothing is done, or null if the repair lands first / it never trips. */
  trips_at_unix: number | null;
  /** Already at shutdown (wells auto shut in). */
  tripped: boolean;
  /** Σ baseline_water_bpd of the wells producing at onset. */
  plan_inflow_bpd: number;
}

const H = 3600;

/** Wells producing at sample `i` (status 1, or unknown → assume producing). */
export function producingWells(ctx: FacilityCtx, i: number) {
  return ctx.fac.wells.filter((_, w) => ctx.wellStatus[w][i] !== 0);
}

/**
 * Countdown for a pump failure that began at sample `onsetIdx`, evaluated at sample `atIdx`.
 * Level anchor: every status-2 sample between onset and `anchorEndIdx` is projected to `atIdx`
 * with the planning rate and averaged (level noise is ±0.15 pct, plan costs move ~$100/pct).
 */
export function countdown(ds: Dataset, ctx: FacilityCtx, onsetIdx: number, atIdx: number, anchorEndIdx: number, repairEndUnix: number): Countdown {
  const { warning, shutdown } = ds.network.defaults.tank_limits_pct;
  const cap = ctx.fac.tank.capacity_bbl;
  const toRate = (bpd: number) => (bpd / 24 / cap) * 100;
  const wells = producingWells(ctx, onsetIdx);
  const plan_inflow_bpd = wells.reduce((s, w) => s + w.baseline_water_bpd, 0);
  const planRate = toRate(plan_inflow_bpd);
  const tAt = ds.ts[atIdx];

  // Did it trip already (by atIdx)?
  for (let i = onsetIdx; i <= atIdx; i++) {
    if (ctx.lv[i] >= shutdown - 0.05 || (i > onsetIdx && ctx.inf[i] === 0 && ctx.lv[i] >= shutdown - 1)) {
      return {
        level_pct: shutdown,
        plan_rate_pct_per_hr: planRate,
        rate_pct_per_hr: 0,
        hours_to_limit: { p10: 0, p50: 0, p90: 0 },
        hours_to_warning: 0,
        trips_at_unix: ds.ts[i],
        tripped: true,
        plan_inflow_bpd,
      };
    }
  }

  // Anchor the level on the climb samples (same producing set, pump down, below the limit).
  const acc: number[] = [];
  const nWells = wells.length;
  for (let i = onsetIdx; i <= Math.min(anchorEndIdx, ds.ts.length - 1); i++) {
    if (ctx.st[i] !== 2 || !(ctx.lv[i] < shutdown - 0.5) || producingWells(ctx, i).length !== nWells) break;
    acc.push(ctx.lv[i] + (planRate * (tAt - ds.ts[i])) / H);
  }
  const level = acc.length ? mean(acc) : ctx.lv[atIdx];

  // Observed inflow over the last hour (12 samples at a 5-min grid, derived from the grid).
  const dt = ds.ts.length > 1 ? ds.ts[1] - ds.ts[0] : 300;
  const nWin = Math.max(1, Math.round(H / dt));
  const inflows: number[] = [];
  for (let i = atIdx; i > atIdx - nWin && i >= 0; i--) if (Number.isFinite(ctx.inf[i])) inflows.push(ctx.inf[i]);
  const obsRate = inflows.length ? toRate(mean(inflows)) : planRate;
  const rateSd = inflows.length > 1 ? toRate(stdev(inflows)) : 0;
  const rate = obsRate > 0 ? obsRate : planRate;
  const hours = (r: number) => (level >= shutdown ? 0 : (shutdown - level) / r);
  const fast = rate + 1.2816 * rateSd;
  const slow = Math.max(rate - 1.2816 * rateSd, 0.1 * rate);
  const p50 = hours(rate);
  const tripUnix = tAt + p50 * H;
  return {
    level_pct: level,
    plan_rate_pct_per_hr: planRate,
    rate_pct_per_hr: rate,
    hours_to_limit: { p10: hours(fast), p50, p90: hours(slow) },
    hours_to_warning: level >= warning ? 0 : (warning - level) / rate,
    trips_at_unix: rate > 0 && tripUnix <= repairEndUnix ? Math.round(tripUnix / 60) * 60 : null,
    tripped: false,
    plan_inflow_bpd,
  };
}
