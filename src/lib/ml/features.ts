// Window features for the learned early-warning scorer. Everything is a deficit relative to the
// facility's own healthy baseline, so the model transfers to networks it has never seen.
import type { Dataset } from "../data/types";
import type { FacilityCtx } from "../detect/events";
import { robustBaseline, type Baseline } from "../detect/stats";

export const FEATURE_NAMES = [
  "recv_def_mean", // receive/pump-flow ratio deficit, mean over window
  "recv_def_max",
  "recv_def_slope", // per hour
  "flow_def_mean", // pump flow / max_flow deficit
  "flow_def_max",
  "flow_def_slope",
  "pp_def", // pipeline psi below running baseline, /100
  "dp_def", // discharge psi below running baseline, /100
] as const;
export const N_FEATURES = FEATURE_NAMES.length;
export const DEFAULT_WINDOW = 12;

export interface WindowSeries {
  /** Hours since the first sample of the window. */
  hours: number[];
  recvDef: number[];
  flowDef: number[];
  ppDef: number[];
  dpDef: number[];
}

export interface FacilityBaselines {
  recv: Baseline;
  flow: Baseline;
  pp: Baseline;
  dp: Baseline;
}

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const max = (a: number[]) => a.reduce((m, x) => (x > m ? x : m), -Infinity);
function slope(x: number[], y: number[]): number {
  const n = x.length;
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
  }
  return sxx > 0 ? sxy / sxx : 0;
}

/** Feature vector for one window (shared by live scoring, training on real data and synthetic data). */
export function featuresFromWindow(w: WindowSeries): number[] {
  return [
    mean(w.recvDef),
    max(w.recvDef),
    slope(w.hours, w.recvDef),
    mean(w.flowDef),
    max(w.flowDef),
    slope(w.hours, w.flowDef),
    mean(w.ppDef) / 100,
    mean(w.dpDef) / 100,
  ];
}

/** Sample indices ≤ endIdx where the pump runs. */
export function runningIdx(ctx: FacilityCtx, endIdx: number): number[] {
  const run: number[] = [];
  for (let i = 0; i <= endIdx; i++) if (ctx.st[i] === 1 && ctx.fl[i] > 0) run.push(i);
  return run;
}

/** Robust per-facility baselines over its running samples ≤ endIdx; null when too few. */
export function facilityBaselines(ctx: FacilityCtx, run: number[]): FacilityBaselines | null {
  const disp = ctx.sys.disposal_site.pressure_psi;
  const recv = robustBaseline(run.map((i) => ctx.rc[i] / ctx.fl[i]));
  const flow = robustBaseline(run.map((i) => ctx.fl[i] / ctx.fac.pump.max_flow_bpd));
  const pp = robustBaseline(run.map((i) => ctx.pp[i] - disp));
  const dp = robustBaseline(run.map((i) => ctx.dp[i] - disp));
  if (!recv || !flow || !pp || !dp) return null;
  return { recv, flow, pp, dp };
}

/** The window of the last `W` running samples ending at running position `pos` (inclusive). */
export function windowAt(ds: Dataset, ctx: FacilityCtx, run: number[], pos: number, b: FacilityBaselines, W = DEFAULT_WINDOW): WindowSeries | null {
  if (pos + 1 < W) return null;
  const disp = ctx.sys.disposal_site.pressure_psi;
  const idx = run.slice(pos + 1 - W, pos + 1);
  const t0 = ds.ts[idx[0]];
  return {
    hours: idx.map((i) => (ds.ts[i] - t0) / 3600),
    recvDef: idx.map((i) => b.recv.m - ctx.rc[i] / ctx.fl[i]),
    flowDef: idx.map((i) => b.flow.m - ctx.fl[i] / ctx.fac.pump.max_flow_bpd),
    ppDef: idx.map((i) => b.pp.m - (ctx.pp[i] - disp)),
    dpDef: idx.map((i) => b.dp.m - (ctx.dp[i] - disp)),
  };
}

/** Live features for a facility as of sample `endIdx`, or null when it has not run enough. */
export function facilityFeatures(ds: Dataset, ctx: FacilityCtx, endIdx: number, W = DEFAULT_WINDOW): { x: number[]; lastRunUnix: number } | null {
  const run = runningIdx(ctx, endIdx);
  if (run.length < W) return null;
  const b = facilityBaselines(ctx, run);
  if (!b) return null;
  const w = windowAt(ds, ctx, run, run.length - 1, b, W);
  return w ? { x: featuresFromWindow(w), lastRunUnix: ds.ts[run[run.length - 1]] } : null;
}
