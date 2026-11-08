export function median(a: ArrayLike<number>): number {
  // Typed-array sort is numeric and native: ~10× faster than Array.sort with a comparator.
  const s = Float64Array.from(a).sort();
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

export function mean(a: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return a.length ? s / a.length : NaN;
}

export function stdev(a: ArrayLike<number>): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - m) ** 2;
  return Math.sqrt(s / (a.length - 1));
}

export interface Baseline {
  /** Robust centre of the healthy cluster. */
  m: number;
  /** Robust per-sample noise (1.4826 × MAD). */
  s: number;
  n: number;
}

/**
 * Healthy baseline of a ratio or pressure series: median + MAD, then two passes trimming low
 * outliers. Faults only ever pull these readings down, so one-sided trimming keeps the healthy
 * cluster even when a third of the samples are degraded.
 */
export function robustBaseline(values: ArrayLike<number>, minN = 24): Baseline | null {
  let kept = Float64Array.from(values).filter(Number.isFinite);
  if (kept.length < minN) return null;
  const absDev = (arr: Float64Array, c: number) => arr.map((x) => Math.abs(x - c));
  let m = median(kept);
  let s = 1.4826 * median(absDev(kept, m));
  for (let pass = 0; pass < 2 && s > 0; pass++) {
    kept = kept.filter((x) => x > m - 3 * s);
    m = median(kept);
    s = 1.4826 * median(absDev(kept, m));
  }
  return { m, s, n: kept.length };
}

/** Last index with ts[i] <= t, or -1. */
export function lastIndexLE(ts: ArrayLike<number>, t: number): number {
  let lo = 0;
  let hi = ts.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
