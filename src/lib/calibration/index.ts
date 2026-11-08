// Calibration: the detector / forecast tunables that the nightly recalibration (scripts/retrain) refits.
// The app reads calibration.json at load; anything missing or malformed falls back to the typed defaults.
import type { Category } from "../data/types";
import raw from "./calibration.json";

/** One drift detector's tunables (leak = receive/pump flow ratio, wear = pump flow/max_flow ratio). */
export interface DriftCalibration {
  /** Floor on the window-mean relative drop that triggers, in ratio units (0.01 = 1 %). */
  ratio_threshold: number;
  /** Consecutive triggering windows required. */
  min_persist: number;
  /** Rolling window length, in running samples. */
  window: number;
  /** z-score trigger: fires above max(ratio_threshold, z × σ/√window), σ measured on the loaded folder. */
  z: number;
}

/** Cross-dataset anomaly scorer fitted on data/external/*.csv (null until that data is provided). */
export interface ExternalPrior {
  sources: string[];
  rows: number;
  features: string[];
  label: string | null;
  model: "logistic_regression" | "zscore";
  mean: number[];
  sd: number[];
  weights: number[] | null;
  bias: number | null;
  /** In-sample rank AUC of the logistic scorer; null for the z-score scorer. */
  auc: number | null;
}

export interface Calibration {
  version: number;
  /** ISO time of the last run that changed anything else in this file. */
  generated_at: string;
  detect: {
    leak: DriftCalibration;
    degradation: DriftCalibration;
    failure: { min_persist: number };
  };
  /** Per-category multiplier on detector confidence, in [0.5, 1]; nudged by confirm / dismiss verdicts. */
  confidence_weights: Record<Category, number>;
  forecast: {
    /** Running flow / max_flow ratio seen in the last hour before past pump failures. */
    fail_ratio_band: number;
    /** Running samples needed before a decline slope is trusted. */
    min_points: number;
  };
  provenance: {
    /** Distinct resolved events behind the fit. */
    outcomes: number;
    /** External CSV rows behind `external_prior`. */
    external: number;
    folders: string[];
    verdicts: { confirmed: number; dismissed: number };
    notes: string[];
  };
  external_prior: ExternalPrior | null;
}

export const DEFAULT_CALIBRATION: Calibration = {
  version: 1,
  generated_at: "1970-01-01T00:00:00.000Z",
  detect: {
    leak: { ratio_threshold: 0.01, min_persist: 2, window: 6, z: 5 },
    degradation: { ratio_threshold: 0.01, min_persist: 3, window: 12, z: 5 },
    failure: { min_persist: 1 },
  },
  confidence_weights: { pump_failure: 1, pipeline_leak: 1, pump_degradation: 1 },
  forecast: { fail_ratio_band: 0.85, min_points: 6 },
  provenance: { outcomes: 0, external: 0, folders: [], verdicts: { confirmed: 0, dismissed: 0 }, notes: [] },
  external_prior: null,
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const pos = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback);
const int = (v: unknown, fallback: number) => Math.max(1, Math.round(pos(v, fallback)));
const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const drift = (v: unknown, d: DriftCalibration): DriftCalibration => {
  const o = isObj(v) ? v : {};
  return { ratio_threshold: pos(o.ratio_threshold, d.ratio_threshold), min_persist: int(o.min_persist, d.min_persist), window: int(o.window, d.window), z: pos(o.z, d.z) };
};

/** calibration.json (or any candidate object) merged over the defaults; every bad number falls back to its default. */
export function loadCalibration(source: unknown = raw): Calibration {
  const d = DEFAULT_CALIBRATION;
  const o = isObj(source) ? source : {};
  const det = isObj(o.detect) ? o.detect : {};
  const fail = isObj(det.failure) ? det.failure : {};
  const cw = isObj(o.confidence_weights) ? o.confidence_weights : {};
  const fc = isObj(o.forecast) ? o.forecast : {};
  const pv = isObj(o.provenance) ? o.provenance : {};
  const vd = isObj(pv.verdicts) ? pv.verdicts : {};
  const weight = (c: Category) => Math.min(1, Math.max(0.5, pos(cw[c], d.confidence_weights[c])));
  return {
    version: int(o.version, d.version),
    generated_at: typeof o.generated_at === "string" ? o.generated_at : d.generated_at,
    detect: {
      leak: drift(det.leak, d.detect.leak),
      degradation: drift(det.degradation, d.detect.degradation),
      failure: { min_persist: int(fail.min_persist, d.detect.failure.min_persist) },
    },
    confidence_weights: { pump_failure: weight("pump_failure"), pipeline_leak: weight("pipeline_leak"), pump_degradation: weight("pump_degradation") },
    forecast: { fail_ratio_band: Math.min(1, pos(fc.fail_ratio_band, d.forecast.fail_ratio_band)), min_points: int(fc.min_points, d.forecast.min_points) },
    provenance: {
      outcomes: count(pv.outcomes),
      external: count(pv.external),
      folders: strings(pv.folders),
      verdicts: { confirmed: count(vd.confirmed), dismissed: count(vd.dismissed) },
      notes: strings(pv.notes),
    },
    external_prior: isObj(o.external_prior) ? (o.external_prior as unknown as ExternalPrior) : null,
  };
}

/** The calibration the app runs with. */
export const calibration: Calibration = loadCalibration();

/** Adapter to the drift detector's option names (`findDriftSegments` in src/lib/detect/drift.ts). */
export function driftParams(d: DriftCalibration): { window: number; z: number; minDrop: number; persist: number } {
  return { window: d.window, z: d.z, minDrop: d.ratio_threshold, persist: d.min_persist };
}
