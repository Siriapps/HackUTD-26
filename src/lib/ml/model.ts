// Multinomial logistic regression, dependency-free and portable: trained by scripts/ml/train.ts,
// weights shipped as early_warning.json, evaluated in the browser. Honest name: a learned linear
// scorer on physics-derived window features, not deep learning.
import type { Category } from "../data/types";

export const CLASSES = ["healthy", "pipeline_leak", "pump_degradation"] as const;
export type ModelClass = (typeof CLASSES)[number];

export interface EarlyWarningModel {
  version: number;
  trained_at: string;
  classes: readonly ModelClass[];
  features: readonly string[];
  /** Standardisation per feature. */
  mean: number[];
  sd: number[];
  /** K rows × (F + 1) columns; last column is the bias. */
  weights: number[][];
  /** Probability above which a facility gets an early warning. */
  threshold: number;
  metrics: {
    /** Leave-one-event-out: minutes before the rule-based onset at which the model first crossed the threshold (negative = earlier). */
    lead_min_by_event: Record<string, number | null>;
    median_lead_min: number | null;
    /** Healthy windows scored above threshold / all healthy windows (held out). */
    false_positive_rate: number;
    /** Held-out windows of each fault class scored correctly / all. */
    recall: Record<Exclude<ModelClass, "healthy">, number>;
  } | null;
  provenance: { real_windows: number; synthetic_windows: number; folders: string[]; notes: string[] };
}

export function softmax(z: number[]): number[] {
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

export function standardise(m: Pick<EarlyWarningModel, "mean" | "sd">, x: number[]): number[] {
  return x.map((v, j) => (v - m.mean[j]) / (m.sd[j] || 1));
}

/** Class probabilities in CLASSES order. */
export function predictProba(m: Pick<EarlyWarningModel, "mean" | "sd" | "weights">, x: number[]): number[] {
  const z = standardise(m, x);
  return softmax(m.weights.map((w) => w.slice(0, -1).reduce((s, wj, j) => s + wj * z[j], 0) + w[w.length - 1]));
}

export interface FitOptions {
  epochs?: number;
  lr?: number;
  l2?: number;
  /** Per-class weights (CLASSES order); default balances classes by frequency. */
  classWeights?: number[];
}

/** Full-batch gradient descent on the weighted cross-entropy with L2. Deterministic. */
export function fitMultinomial(X: number[][], y: number[], opt: FitOptions = {}): Pick<EarlyWarningModel, "mean" | "sd" | "weights"> {
  const n = X.length;
  const F = X[0].length;
  const K = CLASSES.length;
  const { epochs = 600, lr = 0.2, l2 = 1e-3 } = opt;
  const mean = Array.from({ length: F }, (_, j) => X.reduce((s, r) => s + r[j], 0) / n);
  const sd = Array.from({ length: F }, (_, j) => Math.sqrt(X.reduce((s, r) => s + (r[j] - mean[j]) ** 2, 0) / n) || 1);
  const Z = X.map((r) => r.map((v, j) => (v - mean[j]) / sd[j]));
  const counts = Array.from({ length: K }, (_, k) => y.filter((c) => c === k).length);
  const cw = opt.classWeights ?? counts.map((c) => (c ? n / (K * c) : 0));
  const W = Array.from({ length: K }, () => new Array<number>(F + 1).fill(0));
  const grad = Array.from({ length: K }, () => new Array<number>(F + 1).fill(0));
  const totalW = y.reduce((s, c) => s + cw[c], 0);
  for (let ep = 0; ep < epochs; ep++) {
    for (const g of grad) g.fill(0);
    for (let i = 0; i < n; i++) {
      const z = Z[i];
      const p = softmax(W.map((w) => w.slice(0, -1).reduce((s, wj, j) => s + wj * z[j], 0) + w[F]));
      const wi = cw[y[i]];
      for (let k = 0; k < K; k++) {
        const d = (p[k] - (y[i] === k ? 1 : 0)) * wi;
        for (let j = 0; j < F; j++) grad[k][j] += d * z[j];
        grad[k][F] += d;
      }
    }
    for (let k = 0; k < K; k++)
      for (let j = 0; j <= F; j++) W[k][j] -= lr * (grad[k][j] / totalW + (j < F ? l2 * W[k][j] : 0));
  }
  return { mean, sd, weights: W };
}

export const classToCategory = (c: ModelClass): Exclude<Category, "pump_failure"> | null => (c === "healthy" ? null : c);
