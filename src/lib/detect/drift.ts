// Generic primitives for "a reading drifts below its healthy baseline" detection.
// Everything works on sample indices into dataset.ts; `idx` lists the samples where the
// reading is defined (pump running), in ascending order.

export interface Segment {
  /** First sample index of the persistent deficit (before category-specific refinement). */
  start: number;
  /** First sample index back at baseline, or null when still active at the end of `idx`. */
  end: number | null;
  /** Strongest window mean deficit, in units of the window's noise (margin evidence). */
  peakZ: number;
  /** Number of windows the deficit persisted. */
  windows: number;
}

export interface DriftOptions {
  idx: number[];
  deficit: ArrayLike<number>;
  /** Per-sample noise of the reading. */
  sigma: number;
  /** Rolling window length in running samples. */
  window: number;
  /** Trigger when the window mean exceeds max(minDrop, z × sigma/√window). */
  z: number;
  minDrop: number;
  /** Consecutive triggering windows required. */
  persist: number;
  /** Sample index that closes a segment still active at the end of `idx` (e.g. a pump failure), else null. */
  endCap: number | null;
}

/** Forward-window hysteresis detector: trigger on z·σ, release at a third of that. */
export function findDriftSegments(o: DriftOptions): Segment[] {
  const { idx, deficit, window: W, persist: P } = o;
  const K = idx.length - W + 1; // windows that can be filled
  if (K <= 0) return [];
  const sigmaMean = o.sigma / Math.sqrt(W);
  const tOn = Math.max(o.minDrop, o.z * sigmaMean);
  const tOff = tOn / 3;
  const F = new Float64Array(K);
  let acc = 0;
  for (let i = 0; i < idx.length; i++) {
    acc += deficit[idx[i]];
    if (i >= W) acc -= deficit[idx[i - W]];
    if (i >= W - 1) F[i - W + 1] = acc / W;
  }
  const segs: Segment[] = [];
  let k = 0;
  while (k < K) {
    let fires = true;
    for (let p = 0; p < P; p++) if (k + p >= K || !(F[k + p] > tOn)) fires = false;
    if (!fires) {
      k++;
      continue;
    }
    let j = k;
    let peak = 0;
    while (j < K && F[j] >= tOff) {
      if (F[j] > peak) peak = F[j];
      j++;
    }
    segs.push({ start: idx[k], end: j < K ? idx[j] : o.endCap, peakZ: sigmaMean > 0 ? peak / sigmaMean : Infinity, windows: j - k });
    if (j >= K) break;
    k = j + 1;
  }
  return segs;
}

export interface HingeChannel {
  y: ArrayLike<number>;
  m: number;
  s: number;
}

/**
 * Fit "flat at baseline until t0, then a straight ramp" jointly over channels that share t0
 * (flow ratio and discharge pressure for a wearing pump). Returns the best t0 among `cands`
 * and the per-channel slopes (per hour). Least squares, each channel weighted by 1/s².
 */
export function hingeOnset(t: ArrayLike<number>, chans: HingeChannel[], cands: number[]): { t0: number; slopes: number[] } {
  let best: { t0: number; slopes: number[]; sse: number } | null = null;
  for (const t0 of cands) {
    let sse = 0;
    const slopes: number[] = [];
    for (const c of chans) {
      let sxy = 0;
      let sxx = 0;
      for (let i = 0; i < t.length; i++) {
        const x = t[i] >= t0 ? (t[i] - t0) / 3600 : 0;
        sxy += x * (c.y[i] - c.m);
        sxx += x * x;
      }
      const b = sxx > 0 ? sxy / sxx : 0;
      slopes.push(b);
      const w = c.s > 0 ? 1 / (c.s * c.s) : 1;
      for (let i = 0; i < t.length; i++) {
        const x = t[i] >= t0 ? (t[i] - t0) / 3600 : 0;
        const e = c.y[i] - c.m - b * x;
        sse += w * e * e;
      }
    }
    if (!best || sse < best.sse) best = { t0, slopes, sse };
  }
  return best ? { t0: best.t0, slopes: best.slopes } : { t0: cands[0], slopes: chans.map(() => 0) };
}

/**
 * Locate a step in a normalised-deficit sequence (sum of per-channel z-scores) with a matched
 * filter: the position maximising mean(after) − mean(before) over `half` samples each side.
 * An empty "before" (the reading only became observable here) counts as baseline.
 */
export function stepOnset(z: number[], half = 6): number {
  let best = 0;
  let bestScore = -Infinity;
  for (let k = 0; k < z.length; k++) {
    let after = 0;
    let na = 0;
    for (let i = k; i < Math.min(z.length, k + half); i++) {
      after += z[i];
      na++;
    }
    let before = 0;
    let nb = 0;
    for (let i = Math.max(0, k - half); i < k; i++) {
      before += z[i];
      nb++;
    }
    if (na === 0) continue;
    const score = after / na - (nb ? before / nb : 0);
    if (score > bestScore) {
      bestScore = score;
      best = k;
    }
  }
  return best;
}
