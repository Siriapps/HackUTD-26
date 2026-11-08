// Optional cross-dataset prior from data/external/*.csv (the Kaggle SCADA pipeline operations dataset).
// Its column schema is not published, so columns are mapped by name and can be pinned with mapping.json;
// see data/external/README.md. Everything here skips gracefully when the data is absent or unusable.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import type { ExternalPrior } from "../../src/lib/calibration";
import { fitLogistic, median, robustSigma, round } from "../../src/lib/calibration/fit";

const MAX_ROWS = 100_000;
const FEATURE_RE = /flow|pressure|temp|speed|rpm|power|energy|vibration|current|level|density|viscosity/i;
const LABEL_RE = /label|class|event|fault|anomaly|status|target|condition|state/i;
const NORMAL_RE = /^(0|false|no|normal|ok|healthy|none|nominal)$/i;

interface Mapping {
  /** Label column; null = treat the data as unlabelled. */
  label?: string | null;
  features?: string[];
  /** Label values that mean "normal"; everything else is a fault. */
  normal?: string[];
}

export interface ExternalFit {
  prior: ExternalPrior | null;
  rows: number;
  note: string;
}

type Row = Record<string, unknown>;

export function fitExternal(dir: string): ExternalFit {
  if (!existsSync(dir)) return { prior: null, rows: 0, note: "external: data/external missing; skipped" };
  const files = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".csv"))
    .sort();
  if (!files.length) return { prior: null, rows: 0, note: "external: no CSV in data/external; skipped" };
  const mappingPath = path.join(dir, "mapping.json");
  const mapping: Mapping = existsSync(mappingPath) ? JSON.parse(readFileSync(mappingPath, "utf8")) : {};

  const rows: Row[] = [];
  for (const f of files) {
    const parsed = Papa.parse<Row>(readFileSync(path.join(dir, f), "utf8"), { header: true, dynamicTyping: true, skipEmptyLines: true, preview: MAX_ROWS - rows.length });
    rows.push(...parsed.data);
    if (rows.length >= MAX_ROWS) break;
  }
  if (!rows.length) return { prior: null, rows: 0, note: "external: CSV had no rows; skipped" };

  const headers = Object.keys(rows[0]);
  const isNumeric = (h: string) => rows.some((r) => typeof r[h] === "number") && rows.slice(0, 200).every((r) => typeof r[h] === "number" || r[h] == null);
  const features = (mapping.features ?? headers.filter((h) => FEATURE_RE.test(h) && !LABEL_RE.test(h))).filter(isNumeric).slice(0, 8);
  if (!features.length) return { prior: null, rows: rows.length, note: `external: no numeric flow/pressure-like columns among [${headers.join(", ")}]; skipped` };
  const label = mapping.label === undefined ? (headers.find((h) => LABEL_RE.test(h) && !features.includes(h)) ?? null) : mapping.label;
  const normal = mapping.normal ? new RegExp(`^(${mapping.normal.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`, "i") : NORMAL_RE;

  const kept = rows.map((r) => ({ r, x: features.map((h) => (typeof r[h] === "number" ? (r[h] as number) : NaN)) })).filter((k) => k.x.every(Number.isFinite));
  const X = kept.map((k) => k.x);
  const base = { sources: files, rows: X.length, features, label };
  if (label) {
    const y: number[] = kept.map(({ r }) => (r[label] == null || normal.test(String(r[label]).trim()) ? 0 : 1));
    const positives = y.reduce((s, v) => s + v, 0);
    if (positives > 0 && positives < y.length) {
      const fit = fitLogistic(X, y);
      return {
        prior: { ...base, model: "logistic_regression", mean: fit.mean, sd: fit.sd, weights: fit.weights, bias: fit.bias, auc: fit.auc },
        rows: X.length,
        note: `external: logistic scorer on ${X.length} rows × ${features.length} features, label "${label}" (${positives} fault rows), in-sample AUC ${fit.auc}`,
      };
    }
  }
  const mean = features.map((_, j) => round(median(X.map((r) => r[j]))));
  const sd = features.map((_, j) => round(robustSigma(X.map((r) => r[j]), mean[j]) || 1));
  return {
    prior: { ...base, model: "zscore", mean, sd, weights: null, bias: null, auc: null },
    rows: X.length,
    note: `external: z-score scorer (no usable label) on ${X.length} rows × ${features.length} features`,
  };
}
