import { describe, expect, it } from "vitest";
import { DEFAULT_CALIBRATION, driftParams, loadCalibration } from "./index";
import { auc, confidenceWeight, fitLogistic, fitThreshold, persistedWindowMean, quantile } from "./fit";

describe("persistedWindowMean", () => {
  it("is the min over `persist` consecutive window means", () => {
    const out = persistedWindowMean([0, 0, 0, 1, 1, 1, 0, 0], 2, 2);
    expect(Array.from(out)).toEqual([0, 0, 0.5, 1, 0.5, 0]);
    expect(persistedWindowMean([1, 2], 3, 1).length).toBe(0);
  });
});

describe("fitThreshold", () => {
  it("keeps the prior without labelled windows", () => {
    expect(fitThreshold({ healthy_max: 0, event_low: null, event_peak_min: null, prior: 0.01 }).value).toBe(0.01);
    expect(fitThreshold({ healthy_max: 0.005, event_low: null, event_peak_min: null, prior: 0.01 }).value).toBe(0.01);
  });
  it("takes the geometric midpoint, floored at 1.25 × healthy max", () => {
    expect(fitThreshold({ healthy_max: 0.01, event_low: 0.04, event_peak_min: 0.2, prior: 0.02 }).value).toBe(0.02);
    const f = fitThreshold({ healthy_max: 0.01, event_low: 0.011, event_peak_min: 0.2, prior: 0.012 });
    expect(f.value).toBe(0.0125);
    expect(f.reason).toContain("1.25");
  });
  it("caps at half the weakest event peak and rate-limits to ×2 per run", () => {
    expect(fitThreshold({ healthy_max: 0.01, event_low: 0.1, event_peak_min: 0.03, prior: 0.02 }).value).toBe(0.015);
    expect(fitThreshold({ healthy_max: 0.01, event_low: 0.1, event_peak_min: 1, prior: 0.005 }).value).toBe(0.01);
    expect(fitThreshold({ healthy_max: 0.001, event_low: 0.002, event_peak_min: 1, prior: 0.01 }).value).toBe(0.005);
  });
});

describe("confidenceWeight", () => {
  it("is 1 with no verdicts and drops towards 0.5 as dismissals pile up", () => {
    expect(confidenceWeight(0, 0)).toBe(1);
    expect(confidenceWeight(5, 0)).toBe(1);
    expect(confidenceWeight(1, 3)).toBeCloseTo(2 / 3, 4);
    expect(confidenceWeight(0, 5)).toBe(0.5);
  });
});

describe("fitLogistic / auc", () => {
  it("separates a separable set with a positive weight", () => {
    const fit = fitLogistic([[0], [1], [2], [3]], [0, 0, 1, 1]);
    expect(fit.weights[0]).toBeGreaterThan(0);
    expect(fit.auc).toBe(1);
    expect(auc([1, 1, 2, 2], [0, 1, 0, 1])).toBe(0.5);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });
});

describe("loadCalibration", () => {
  it("falls back to defaults for anything missing or malformed", () => {
    const c = loadCalibration({ detect: { leak: { ratio_threshold: -1, window: 8 } }, forecast: { fail_ratio_band: "x" }, confidence_weights: { pipeline_leak: 0.1 } });
    expect(c.detect.leak).toEqual({ ...DEFAULT_CALIBRATION.detect.leak, window: 8 });
    expect(c.detect.degradation).toEqual(DEFAULT_CALIBRATION.detect.degradation);
    expect(c.forecast.fail_ratio_band).toBe(DEFAULT_CALIBRATION.forecast.fail_ratio_band);
    expect(c.confidence_weights.pipeline_leak).toBe(0.5);
    expect(loadCalibration(undefined).detect.leak.ratio_threshold).toBeGreaterThan(0);
    expect(driftParams(c.detect.leak)).toEqual({ window: 8, z: 5, minDrop: 0.01, persist: 2 });
  });
});
