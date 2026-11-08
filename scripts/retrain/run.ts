/**
 * Nightly recalibration. Honest name: threshold refit + regression refit on summary statistics; no deep learning.
 *
 *   npx tsx scripts/retrain/run.ts [--summary <file.md>] [--dry-run]      (from the repo root)
 *
 * 1. Loads every public/data/<folder>/ that has network.json, ops.json, telemetry.csv. Answer keys are never read.
 * 2. Runs analyse() + deriveOutcomes() per folder and writes data/outcomes/<folder>.json.
 * 3. Merges data/outcomes/*.json (nightly files plus any session exports carrying operator verdicts), labels
 *    healthy and event windows, and refits the leak / wear ratio thresholds, the per-category confidence weights
 *    and the degradation-forecast fail band.
 * 4. Optionally fits a tiny anomaly scorer on data/external/*.csv (see data/external/README.md).
 * 5. Writes src/lib/calibration/calibration.json only when something other than the timestamp changed, and
 *    prints a markdown summary (also to --summary) for the PR body.
 * Deterministic for a given repo state; the whole run takes seconds.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { analyse } from "../../src/lib/analyse";
import { loadCalibration, type Calibration, type DriftCalibration } from "../../src/lib/calibration";
import { confidenceWeight, fitThreshold, median, persistedWindowMean, quantile, robustSigma, round, type ThresholdEvidence } from "../../src/lib/calibration/fit";
import { datasetFromStrings } from "../../src/lib/data/load";
import { seriesKey, type Category, type Dataset, type Facility } from "../../src/lib/data/types";
import { deriveOutcomes, type Outcome } from "../../src/lib/memory/outcomes";
import { fitExternal } from "./external";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "public", "data");
const OUTCOMES_DIR = path.join(ROOT, "data", "outcomes");
const EXTERNAL_DIR = path.join(ROOT, "data", "external");
const CAL_PATH = path.join(ROOT, "src", "lib", "calibration", "calibration.json");
const REQUIRED = ["network.json", "ops.json", "telemetry.csv"];
const H = 3600;

const args = process.argv.slice(2);
const summaryPath = args.includes("--summary") ? args[args.indexOf("--summary") + 1] : null;
const dryRun = args.includes("--dry-run");
const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
const physicalKey = (o: Outcome) => `${o.asset}|${o.category}|${o.onset_unix}`;

function loadFolder(folder: string): Dataset {
  const dir = path.join(DATA_DIR, folder);
  return datasetFromStrings(
    folder,
    JSON.parse(readFileSync(path.join(dir, "network.json"), "utf8")),
    JSON.parse(readFileSync(path.join(dir, "ops.json"), "utf8")),
    readFileSync(path.join(dir, "telemetry.csv"), "utf8"),
  );
}

type DriftCategory = "pipeline_leak" | "pump_degradation";

interface Evidence {
  healthy: number[];
  event: number[];
  /** Peak statistic per physical event. */
  peaks: Map<string, number>;
  /** Robust per-sample noise of the ratio on healthy samples, per facility. */
  sigma: number[];
}

/**
 * Label every trigger-statistic window of one folder for one drift category. A window is healthy when no sample
 * in it (± one window of guard) lies in any outcome window of the facility, and an event window when it lies
 * wholly inside one outcome window of this category after a burn-in of one statistic span. Folders without any
 * outcome windows contribute nothing: unlabelled data cannot be assumed healthy.
 */
function collectEvidence(ds: Dataset, outcomes: Outcome[], cat: DriftCategory, cal: DriftCalibration, into: Evidence) {
  if (!outcomes.length) return;
  const span = cal.window + cal.min_persist - 1;
  for (const sys of ds.network.systems) {
    for (const fac of sys.facilities) {
      const mine = outcomes.filter((o) => o.facility === fac.id);
      const st = ds.series.get(seriesKey(fac.pump.id, "status"));
      const fl = ds.series.get(seriesKey(fac.pump.id, "flow_bpd"));
      const rc = ds.series.get(seriesKey(fac.pipeline.id, "receive_flow_bpd"));
      if (!st || !fl || !rc) continue;
      const run: number[] = [];
      for (let i = 0; i < ds.ts.length; i++) if (st[i] === 1 && fl[i] > 0) run.push(i);
      const ratio = run.map((i) => (cat === "pipeline_leak" ? rc[i] / fl[i] : fl[i] / fac.pump.max_flow_bpd));
      const inAny = run.map((i) => mine.some((o) => o.onset_unix <= ds.ts[i] && ds.ts[i] <= o.end_unix));
      const eventOf = run.map((i) => mine.find((o) => o.category === cat && o.onset_unix <= ds.ts[i] && ds.ts[i] <= o.end_unix) ?? null);
      const guarded = inAny.map((_, k) => {
        for (let j = Math.max(0, k - cal.window); j <= Math.min(run.length - 1, k + cal.window); j++) if (inAny[j]) return true;
        return false;
      });
      const healthyRatios = ratio.filter((_, k) => !guarded[k]);
      const m = median(healthyRatios.length >= 24 ? healthyRatios : ratio);
      if (!Number.isFinite(m)) continue;
      if (healthyRatios.length >= 24) into.sigma.push(robustSigma(healthyRatios, m));
      const stat = persistedWindowMean(
        ratio.map((r) => m - r),
        cal.window,
        cal.min_persist,
      );
      const firstRun = new Map<Outcome, number>();
      eventOf.forEach((o, k) => {
        if (o && !firstRun.has(o)) firstRun.set(o, k);
      });
      for (let k = 0; k < stat.length; k++) {
        let healthy = true;
        const o = eventOf[k];
        let event = o !== null && k >= firstRun.get(o)! + span;
        for (let j = k; j < k + span; j++) {
          if (guarded[j]) healthy = false;
          if (eventOf[j] !== o) event = false;
        }
        if (healthy) into.healthy.push(stat[k]);
        else if (event && o) {
          into.event.push(stat[k]);
          const pk = physicalKey(o);
          into.peaks.set(pk, Math.max(into.peaks.get(pk) ?? -Infinity, stat[k]));
        }
      }
    }
  }
}

/** Median running flow / max_flow over the last hour before each pump failure that a wear event ran into. */
function preFailureRatios(ds: Dataset, outcomes: Outcome[]): Map<string, number> {
  const out = new Map<string, number>();
  const dt = ds.ts.length > 1 ? ds.ts[1] - ds.ts[0] : 300;
  const perHour = Math.max(1, Math.round(H / dt));
  const facilities = new Map<string, Facility>();
  for (const s of ds.network.systems) for (const f of s.facilities) facilities.set(f.id, f);
  for (const fail of outcomes) {
    if (fail.category !== "pump_failure") continue;
    const wear = outcomes.find((o) => o.category === "pump_degradation" && o.asset === fail.asset && o.end_unix <= fail.onset_unix && fail.onset_unix - o.end_unix <= 6 * H);
    const fac = facilities.get(fail.facility);
    if (!wear || !fac) continue;
    const st = ds.series.get(seriesKey(fac.pump.id, "status"));
    const fl = ds.series.get(seriesKey(fac.pump.id, "flow_bpd"));
    if (!st || !fl) continue;
    const ratios: number[] = [];
    for (let i = ds.ts.length - 1; i >= 0 && ratios.length < perHour; i--) {
      if (ds.ts[i] >= fail.onset_unix) continue;
      if (st[i] === 1 && fl[i] > 0) ratios.push(fl[i] / fac.pump.max_flow_bpd);
    }
    if (ratios.length) out.set(physicalKey(fail), median(ratios));
  }
  return out;
}

function main() {
  const prior = loadCalibration(JSON.parse(readFileSync(CAL_PATH, "utf8")));
  const folders = existsSync(DATA_DIR)
    ? readdirSync(DATA_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory() && REQUIRED.every((f) => existsSync(path.join(DATA_DIR, d.name, f))))
        .map((d) => d.name)
        .sort()
    : [];

  // 1–2. Load, analyse, derive and persist outcomes per folder.
  const datasets = new Map<string, Dataset>();
  mkdirSync(OUTCOMES_DIR, { recursive: true });
  for (const folder of folders) {
    const ds = loadFolder(folder);
    datasets.set(folder, ds);
    const outcomes = deriveOutcomes(ds, analyse(ds));
    if (!dryRun) writeFileSync(path.join(OUTCOMES_DIR, `${folder}.json`), json(outcomes));
    console.log(`${folder}: ${ds.ts.length} samples, ${outcomes.length} resolved outcomes`);
  }

  // 3. Merge every outcomes file; session exports may add verdicts for the same physical events.
  const merged: Outcome[] = readdirSync(OUTCOMES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) => JSON.parse(readFileSync(path.join(OUTCOMES_DIR, f), "utf8")) as Outcome[]);
  const physical = new Map<string, Outcome>();
  for (const o of merged) {
    const prev = physical.get(physicalKey(o));
    if (!prev || (o.verdict && !prev.verdict)) physical.set(physicalKey(o), o);
  }
  const byFolder = new Map<string, Outcome[]>();
  for (const o of merged) byFolder.set(o.folder, [...(byFolder.get(o.folder) ?? []), o]);

  const notes: string[] = [];
  const fits: Record<DriftCategory, { fit: ReturnType<typeof fitThreshold>; ev: Evidence }> = {
    pipeline_leak: { fit: { value: prior.detect.leak.ratio_threshold, reason: "" }, ev: { healthy: [], event: [], peaks: new Map(), sigma: [] } },
    pump_degradation: { fit: { value: prior.detect.degradation.ratio_threshold, reason: "" }, ev: { healthy: [], event: [], peaks: new Map(), sigma: [] } },
  };
  for (const cat of ["pipeline_leak", "pump_degradation"] as const) {
    const cal = cat === "pipeline_leak" ? prior.detect.leak : prior.detect.degradation;
    const ev = fits[cat].ev;
    for (const [folder, ds] of datasets) collectEvidence(ds, byFolder.get(folder) ?? [], cat, cal, ev);
    const evidence: ThresholdEvidence = {
      healthy_max: ev.healthy.reduce((m, x) => (x > m ? x : m), 0),
      event_low: ev.event.length ? quantile(ev.event, 0.1) : null,
      event_peak_min: ev.peaks.size ? Math.min(...ev.peaks.values()) : null,
      prior: cal.ratio_threshold,
    };
    fits[cat].fit = fitThreshold(evidence);
    const sigma = ev.sigma.length ? round(median(ev.sigma)) : "n/a";
    notes.push(`${cat}: ${ev.healthy.length} healthy windows (max statistic ${round(evidence.healthy_max)}, median σ ${sigma}), ${ev.event.length} event windows over ${ev.peaks.size} events`);
  }

  // Confidence weights from operator verdicts, per category.
  const verdicts: Record<Category, { confirmed: number; dismissed: number }> = { pump_failure: { confirmed: 0, dismissed: 0 }, pipeline_leak: { confirmed: 0, dismissed: 0 }, pump_degradation: { confirmed: 0, dismissed: 0 } };
  for (const o of physical.values()) if (o.verdict) verdicts[o.category][o.verdict]++;
  const weights = (Object.keys(verdicts) as Category[]).reduce(
    (acc, c) => ({ ...acc, [c]: confidenceWeight(verdicts[c].confirmed, verdicts[c].dismissed) }),
    {} as Record<Category, number>,
  );
  const totalVerdicts = (Object.values(verdicts) as { confirmed: number; dismissed: number }[]).reduce((a, v) => ({ confirmed: a.confirmed + v.confirmed, dismissed: a.dismissed + v.dismissed }), { confirmed: 0, dismissed: 0 });

  // Forecast fail band: the ratio worn pumps actually failed at.
  const pre = new Map<string, number>();
  for (const [folder, ds] of datasets) for (const [k, v] of preFailureRatios(ds, byFolder.get(folder) ?? [])) pre.set(k, v);
  const band = pre.size ? round(median([...pre.values()]), 3) : null;
  notes.push(pre.size ? `forecast: ${pre.size} wear→failure pairs failed at median ratio ${band}` : "forecast: no wear→failure pairs yet; band kept");

  // 4. External prior.
  const ext = fitExternal(EXTERNAL_DIR);
  notes.push(ext.note);

  // 5. Assemble, compare, write.
  const next: Calibration = loadCalibration({
    version: 1,
    generated_at: prior.generated_at,
    detect: {
      leak: { ...prior.detect.leak, ratio_threshold: fits.pipeline_leak.fit.value },
      degradation: { ...prior.detect.degradation, ratio_threshold: fits.pump_degradation.fit.value },
      failure: prior.detect.failure,
    },
    confidence_weights: weights,
    forecast: { fail_ratio_band: band ?? prior.forecast.fail_ratio_band, min_points: prior.forecast.min_points },
    provenance: { outcomes: physical.size, external: ext.rows, folders, verdicts: totalVerdicts, notes },
    external_prior: ext.prior,
  });
  const changed = JSON.stringify({ ...next, generated_at: 0 }) !== JSON.stringify({ ...prior, generated_at: 0 });
  if (changed) next.generated_at = new Date().toISOString();

  const row = (name: string, before: unknown, after: unknown, basis: string) => `| ${name} | ${before} | ${after} | ${basis} |`;
  const summary = [
    `## Nightly recalibration${changed ? "" : " (no change)"}`,
    "",
    "| Parameter | Before | After | Basis |",
    "|---|---|---|---|",
    row("detect.leak.ratio_threshold", prior.detect.leak.ratio_threshold, next.detect.leak.ratio_threshold, fits.pipeline_leak.fit.reason),
    row("detect.degradation.ratio_threshold", prior.detect.degradation.ratio_threshold, next.detect.degradation.ratio_threshold, fits.pump_degradation.fit.reason),
    ...(Object.keys(weights) as Category[]).map((c) => row(`confidence_weights.${c}`, prior.confidence_weights[c], next.confidence_weights[c], `${verdicts[c].confirmed} confirmed / ${verdicts[c].dismissed} dismissed`)),
    row("forecast.fail_ratio_band", prior.forecast.fail_ratio_band, next.forecast.fail_ratio_band, pre.size ? `${pre.size} wear→failure pairs` : "no pairs yet"),
    row("provenance.outcomes", prior.provenance.outcomes, next.provenance.outcomes, `folders: ${folders.join(", ") || "none"}`),
    row("provenance.external", prior.provenance.external, next.provenance.external, ext.prior ? `${ext.prior.model} on ${ext.prior.features.join(", ")}` : "no external data"),
    "",
    ...notes.map((n) => `- ${n}`),
    "",
    "Method: max-margin threshold refit with zero false positives on healthy windows, Laplace-smoothed verdict precision for confidence weights, median pre-failure ratio for the forecast band. Recalibration and regression refit, not deep learning.",
    "",
  ].join("\n");
  console.log("\n" + summary);
  if (summaryPath) writeFileSync(summaryPath, summary);
  if (changed && !dryRun) {
    writeFileSync(CAL_PATH, json(next));
    console.log(`wrote ${path.relative(ROOT, CAL_PATH)}`);
  } else console.log(dryRun ? "dry run: nothing written" : "calibration.json unchanged");
}

main();
