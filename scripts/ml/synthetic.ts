// Synthetic training windows from the known physics of the three problems, at random severities,
// so the scorer sees thousands of early-phase examples instead of ten labelled events.
// Training-only code: noise levels and the psi/ratio coupling are measured from the real data
// by train.ts and passed in; nothing here is used by the app.
import { featuresFromWindow, DEFAULT_WINDOW, type WindowSeries } from "../../src/lib/ml/features";

export interface SyntheticConfig {
  n: number;
  /** Measured per-sample noise of each channel (ratio units, ratio units, psi, psi). */
  sigma: { recv: number; flow: number; pp: number; dp: number };
  /** Measured couplings from the real events: psi drop per unit of ratio deficit. */
  coupling: { leakPpPerRatio: number; leakPpStep: number; wearDpPerRatio: number };
  /** Hours between samples. */
  dtH: number;
  seed?: number;
}

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateSynthetic(cfg: SyntheticConfig): { X: number[][]; y: number[] } {
  const r = rng(cfg.seed ?? 42);
  const U = (a: number, b: number) => a + (b - a) * r();
  const N = (s: number) => {
    // Box–Muller
    const u = Math.max(r(), 1e-12);
    const v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * s;
  };
  const W = DEFAULT_WINDOW;
  const X: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < cfg.n; i++) {
    const cls = i % 3; // balanced
    const hours = Array.from({ length: W }, (_, k) => k * cfg.dtH);
    const w: WindowSeries = { hours, recvDef: [], flowDef: [], ppDef: [], dpDef: [] };
    if (cls === 0) {
      // healthy: pure noise, occasionally a slight benign offset (baseline estimate error)
      const off = N(cfg.sigma.recv / 3);
      const offF = N(cfg.sigma.flow / 3);
      for (let k = 0; k < W; k++) {
        w.recvDef.push(off + N(cfg.sigma.recv));
        w.flowDef.push(offF + N(cfg.sigma.flow));
        w.ppDef.push(N(cfg.sigma.pp));
        w.dpDef.push(N(cfg.sigma.dp));
      }
    } else if (cls === 1) {
      // leak: ratio deficit starts at a0 and grows at rate per hour; window begins t0 hours after onset
      // (t0 may be negative: the fault starts inside the window → the hardest, most valuable cases).
      const a0 = U(0.004, 0.03);
      const rate = U(0.0005, 0.006);
      const t0 = U(-W * cfg.dtH * 0.8, 10);
      for (let k = 0; k < W; k++) {
        const t = t0 + hours[k];
        const d = t > 0 ? a0 + rate * t : 0;
        w.recvDef.push(d + N(cfg.sigma.recv));
        w.flowDef.push(N(cfg.sigma.flow));
        w.ppDef.push((t > 0 ? cfg.coupling.leakPpStep + cfg.coupling.leakPpPerRatio * d : 0) + N(cfg.sigma.pp));
        w.dpDef.push(N(cfg.sigma.dp));
      }
    } else {
      // wear: flow ratio deficit ramps from onset; discharge sags in proportion.
      const rate = U(0.0015, 0.012);
      const t0 = U(-W * cfg.dtH * 0.8, 30);
      for (let k = 0; k < W; k++) {
        const t = t0 + hours[k];
        const d = t > 0 ? rate * t : 0;
        w.recvDef.push(N(cfg.sigma.recv));
        w.flowDef.push(d + N(cfg.sigma.flow));
        w.ppDef.push(N(cfg.sigma.pp));
        w.dpDef.push(cfg.coupling.wearDpPerRatio * d + N(cfg.sigma.dp));
      }
    }
    X.push(featuresFromWindow(w));
    y.push(cls);
  }
  return { X, y };
}
