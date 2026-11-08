import { describe, expect, it } from "vitest";
import { analyse } from "../analyse";
import { loadFixture } from "../data/fixtures";
import { facilityContexts } from "../detect/events";
import { model, modelTrained } from "./index";
import { facilityFeatures, N_FEATURES } from "./features";
import { CLASSES, fitMultinomial, predictProba } from "./model";

describe("multinomial logistic regression", () => {
  it("learns a separable 3-class problem", () => {
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 300; i++) {
      const c = i % 3;
      const base = Array.from({ length: N_FEATURES }, () => (Math.sin(i * 7.1 + c) * 0.1));
      if (c === 1) base[0] += 1;
      if (c === 2) base[3] += 1;
      X.push(base);
      y.push(c);
    }
    const m = fitMultinomial(X, y, { epochs: 300 });
    let ok = 0;
    for (let i = 0; i < X.length; i++) {
      const p = predictProba(m, X[i]);
      expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
      if (p.indexOf(Math.max(...p)) === y[i]) ok++;
    }
    expect(ok / X.length).toBeGreaterThan(0.98);
  });
});

describe("shipped early-warning model", () => {
  it("is trained and scores every facility with valid probabilities", () => {
    expect(modelTrained()).toBe(true);
    expect(model.classes).toEqual(CLASSES);
    expect(model.weights.length).toBe(3);
    expect(model.weights[0].length).toBe(N_FEATURES + 1);
    const ds = loadFixture("snapshot_2026-10-08T1200");
    const nowIdx = ds.ts.length - 1;
    for (const ctx of facilityContexts(ds)) {
      const f = facilityFeatures(ds, ctx, nowIdx);
      expect(f, ctx.fac.id).not.toBeNull();
      const p = predictProba(model, f!.x);
      expect(p.every((v) => v >= 0 && v <= 1)).toBe(true);
    }
  });

  it("agrees with the rules on ongoing drift events and never duplicates them as warnings", () => {
    const ds = loadFixture("snapshot_2026-10-08T1200");
    const a = analyse(ds);
    const drift = a.alerts.filter((e) => e.category !== "pump_failure");
    expect(drift.length).toBeGreaterThan(0);
    for (const e of drift) {
      expect(e.ml_probability, e.id).toBeDefined();
      expect(e.ml_probability!).toBeGreaterThan(0.5);
    }
    for (const w of a.warnings ?? []) {
      expect(drift.some((e) => e.facility === w.facility && e.category === w.category)).toBe(false);
      expect(w.probability).toBeGreaterThanOrEqual(model.threshold);
    }
  });

  it("raises no false early warnings on a healthy network cut (first day of full_week)", () => {
    const ds = loadFixture("full_week");
    const a = analyse(ds, ds.ts[0] + 5 * 3600); // 05:00 on day 1, before the first event at 06:00
    expect(a.events).toEqual([]);
    expect(a.warnings ?? []).toEqual([]);
  });
});
