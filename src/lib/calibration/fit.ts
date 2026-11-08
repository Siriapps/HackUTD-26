// Pure fitting helpers behind scripts/retrain. Honest names: threshold refits and small regressions on
// summary statistics, nothing deeper.

export const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

export function median(a: ArrayLike<number>): number {
  const s = Array.from(a).filter(Number.isFinite).sort((x, y) => x - y);
  const n = s.length;
  if (!n) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** Linear-interpolated quantile, q in [0, 1]. */
export function quantile(a: ArrayLike<number>, q: number): number {
  const s = Array.from(a).filter(Number.isFinite).sort((x, y) => x - y);
  if (!s.length) return NaN;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  return lo + 1 < s.length ? s[lo] + (s[lo + 1] - s[lo]) * (pos - lo) : s[lo];
}

/** Robust per-sample noise: 1.4826 × median absolute deviation. */
export function robustSigma(a: ArrayLike<number>, m = median(a)): number {
  return 1.4826 * median(Array.from(a, (x) => Math.abs(x - m)));
}

/**
 * The drift detector's trigger statistic: the mean of `deficit` over `window` consecutive samples, then the
 * minimum over `persist` consecutive window means. Entry k covers samples k .. k+window+persist-2 and a
 * persisted crossing starts at k iff out[k] > threshold.
 */
export function persistedWindowMean(deficit: ArrayLike<number>, window: number, persist: number): Float64Array {
  const K = deficit.length - window + 1;
  const n = K - persist + 1;
  if (window < 1 || persist < 1 || n <= 0) return new Float64Array(0);
  const F = new Float64Array(K);
  let acc = 0;
  for (let i = 0; i < deficit.length; i++) {
    acc += deficit[i];
    if (i >= window) acc -= deficit[i - window];
    if (i >= window - 1) F[i - window + 1] = acc / window;
  }
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let m = Infinity;
    for (let p = 0; p < persist; p++) if (F[k + p] < m) m = F[k + p];
    out[k] = m;
  }
  return out;
}

export interface ThresholdEvidence {
  /** Loudest trigger statistic on windows known to be healthy (0 when none are known). */
  healthy_max: number;
  /** 10th percentile of the statistic inside known event windows after burn-in; null without events. */
  event_low: number | null;
  /** Weakest known event's peak statistic; null without events. */
  event_peak_min: number | null;
  /** Current calibrated value. */
  prior: number;
}

export interface ThresholdFit {
  value: number;
  reason: string;
}

/**
 * Max-margin refit of a drift threshold: the geometric midpoint between the loudest healthy window and the
 * quietest event evidence, floored so no healthy window on record triggers (25 % margin), capped so the weakest
 * known event still triggers with 2× margin, and never moved by more than ×2 per run. Without labelled windows
 * the prior is kept: guessing "healthy" from unlabelled data would hide any event the detector missed.
 */
export function fitThreshold(e: ThresholdEvidence): ThresholdFit {
  if (e.event_low === null || e.event_peak_min === null || !(e.healthy_max > 0)) {
    return { value: e.prior, reason: "no labelled windows yet; prior kept" };
  }
  const floor = 1.25 * e.healthy_max;
  const cap = 0.5 * e.event_peak_min;
  let v = Math.sqrt(e.healthy_max * e.event_low);
  const notes = [`midpoint ${round(v)} of healthy max ${round(e.healthy_max)} and event p10 ${round(e.event_low)}`];
  if (v < floor) {
    v = floor;
    notes.push("raised to 1.25 × healthy max");
  }
  if (v > cap) {
    v = cap;
    notes.push(`capped at half the weakest event peak ${round(e.event_peak_min)}`);
  }
  if (cap < floor) notes.push("warning: healthy and event windows overlap");
  const limited = Math.min(Math.max(v, e.prior / 2), e.prior * 2);
  if (limited !== v) notes.push(`rate-limited from ${round(v)} (max ×2 per run)`);
  return { value: round(limited), reason: notes.join("; ") };
}

/** Per-category confidence multiplier: Laplace-smoothed precision of operator verdicts; 1 with none, floored at 0.5. */
export function confidenceWeight(confirmed: number, dismissed: number): number {
  return round(Math.min(1, Math.max(0.5, (2 * (confirmed + 1)) / (confirmed + dismissed + 2))));
}

export interface LogisticFit {
  mean: number[];
  sd: number[];
  weights: number[];
  bias: number;
  /** Rank AUC on the training rows: an in-sample honesty check, not a validation score. */
  auc: number;
}

/** Tiny deterministic logistic regression: standardised features, full-batch gradient descent, zero init. */
export function fitLogistic(X: number[][], y: number[], iters = 300, lr = 0.5): LogisticFit {
  const n = X.length;
  const d = n ? X[0].length : 0;
  const mean = new Array<number>(d).fill(0);
  const sd = new Array<number>(d).fill(1);
  for (let j = 0; j < d; j++) {
    let s = 0;
    for (const row of X) s += row[j];
    mean[j] = s / n;
    let v = 0;
    for (const row of X) v += (row[j] - mean[j]) ** 2;
    sd[j] = Math.sqrt(v / n) || 1;
  }
  const Z = X.map((row) => row.map((x, j) => (x - mean[j]) / sd[j]));
  const w = new Array<number>(d).fill(0);
  let b = 0;
  for (let it = 0; it < iters; it++) {
    const gw = new Array<number>(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * Z[i][j];
      const err = 1 / (1 + Math.exp(-z)) - y[i];
      for (let j = 0; j < d; j++) gw[j] += err * Z[i][j];
      gb += err;
    }
    for (let j = 0; j < d; j++) w[j] -= (lr * gw[j]) / n;
    b -= (lr * gb) / n;
  }
  const scores = Z.map((z) => z.reduce((s, x, j) => s + w[j] * x, b));
  return { mean: mean.map((x) => round(x)), sd: sd.map((x) => round(x)), weights: w.map((x) => round(x)), bias: round(b), auc: round(auc(scores, y)) };
}

/** Mann-Whitney AUC: the probability a random positive outscores a random negative (ties count half). */
export function auc(scores: number[], y: number[]): number {
  const idx = scores.map((_, i) => i).sort((a, b) => scores[a] - scores[b]);
  const rank = new Float64Array(scores.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && scores[idx[j + 1]] === scores[idx[i]]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) rank[idx[k]] = r;
    i = j + 1;
  }
  let pos = 0;
  let sum = 0;
  for (let i = 0; i < y.length; i++) {
    if (y[i] === 1) {
      pos++;
      sum += rank[i];
    }
  }
  const neg = y.length - pos;
  return pos && neg ? (sum - (pos * (pos + 1)) / 2) / (pos * neg) : NaN;
}
