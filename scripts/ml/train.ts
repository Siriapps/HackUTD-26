/**
 * Train the early-warning scorer (multinomial logistic regression on window features).
 *
 *   npx tsx scripts/ml/train.ts [--dry-run] [--summary <file.md>]
 *
 * Real windows: every 12-running-sample window of every facility in public/data/full_week
 * (the other history folders are prefixes of it), labelled from fixtures/full_week/answer_key.json
 * (training-only; the app never reads keys): the first 12 h after a leak/wear onset is that class,
 * anything ≥ 2 h away from every event is healthy, the rest is left out as ambiguous.
 * Synthetic windows: scripts/ml/synthetic.ts at noise/coupling levels measured on the real data.
 * Evaluation: leave-one-event-out over the real drift events → lead time vs the key's onset and
 * false-positive rate on that facility's healthy windows. Then a final fit on everything.
 * Writes src/lib/ml/early_warning.json (unless --dry-run) and prints a markdown summary.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { datasetFromStrings } from "../../src/lib/data/load";
import type { Category, Dataset } from "../../src/lib/data/types";
import { facilityContexts, type FacilityCtx } from "../../src/lib/detect/events";
import { median } from "../../src/lib/detect/stats";
import { DEFAULT_WINDOW, FEATURE_NAMES, facilityBaselines, featuresFromWindow, runningIdx, windowAt } from "../../src/lib/ml/features";
import { CLASSES, fitMultinomial, predictProba, type EarlyWarningModel } from "../../src/lib/ml/model";
import { generateSynthetic } from "./synthetic";

const ROOT = process.cwd();
const FOLDER = "full_week";
const OUT = path.join(ROOT, "src", "lib", "ml", "early_warning.json");
const H = 3600;
const EARLY_H = 12; // hours after onset that count as "early phase"
const GUARD_H = 2;
const THRESHOLD = 0.5;
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const summaryPath = args.includes("--summary") ? args[args.indexOf("--summary") + 1] : null;

interface KeyEvent {
  id: string;
  facility: string;
  category: Category;
  onset_unix: number;
  end_unix: number | null;
}
interface RealWindow {
  x: number[];
  y: number;
  facility: string;
  endUnix: number;
  event: string | null;
}

function load(folder: string): Dataset {
  const dir = path.join(ROOT, "public", "data", folder);
  return datasetFromStrings(folder, JSON.parse(readFileSync(path.join(dir, "network.json"), "utf8")), JSON.parse(readFileSync(path.join(dir, "ops.json"), "utf8")), readFileSync(path.join(dir, "telemetry.csv"), "utf8"));
}

const classIdx = (c: Category) => (c === "pipeline_leak" ? 1 : c === "pump_degradation" ? 2 : -1);

function realWindows(ds: Dataset, ctxs: FacilityCtx[], key: KeyEvent[]) {
  const windows: RealWindow[] = [];
  const sigma = { recv: [] as number[], flow: [] as number[], pp: [] as number[], dp: [] as number[] };
  for (const ctx of ctxs) {
    const run = runningIdx(ctx, ds.ts.length - 1);
    const b = facilityBaselines(ctx, run);
    if (!b) continue;
    sigma.recv.push(b.recv.s);
    sigma.flow.push(b.flow.s);
    sigma.pp.push(b.pp.s);
    sigma.dp.push(b.dp.s);
    const mine = key.filter((k) => k.facility === ctx.fac.id);
    for (let pos = DEFAULT_WINDOW - 1; pos < run.length; pos++) {
      const w = windowAt(ds, ctx, run, pos, b);
      if (!w) continue;
      const t = ds.ts[run[pos]];
      let label: number | null = 0;
      let ev: string | null = null;
      for (const k of mine) {
        const end = k.end_unix ?? Infinity;
        if (k.category === "pump_failure") {
          if (t >= k.onset_unix - GUARD_H * H && t <= end + GUARD_H * H) label = null;
          continue;
        }
        if (t >= k.onset_unix && t <= Math.min(end, k.onset_unix + EARLY_H * H)) {
          label = classIdx(k.category);
          ev = k.id;
        } else if (t >= k.onset_unix - GUARD_H * H && t <= end + GUARD_H * H && label === 0) label = null;
      }
      if (label === null) continue;
      windows.push({ x: featuresFromWindow(w), y: label, facility: ctx.fac.id, endUnix: t, event: ev });
    }
  }
  return { windows, sigma: { recv: median(sigma.recv), flow: median(sigma.flow), pp: median(sigma.pp), dp: median(sigma.dp) } };
}

/** Couplings measured from the real early-phase windows (psi deficit per unit ratio deficit). */
function couplings(ws: RealWindow[]) {
  const ratio = (cls: number, num: number, den: number) => {
    const xs = ws.filter((w) => w.y === cls && w.x[den] > 0.005).map((w) => (w.x[num] * 100) / w.x[den]);
    return xs.length ? median(xs) : 0;
  };
  const leakStep = median(ws.filter((w) => w.y === 1).map((w) => w.x[6] * 100));
  return { leakPpPerRatio: Math.max(0, ratio(1, 6, 0) - leakStep / 0.05), leakPpStep: Math.max(0, leakStep), wearDpPerRatio: Math.max(0, ratio(2, 7, 3)) };
}

function evaluate(real: RealWindow[], synth: { X: number[][]; y: number[] }, key: KeyEvent[]) {
  const events = key.filter((k) => k.category !== "pump_failure");
  const lead: Record<string, number | null> = {};
  let fp = 0;
  let healthyN = 0;
  const hit: Record<1 | 2, { ok: number; n: number }> = { 1: { ok: 0, n: 0 }, 2: { ok: 0, n: 0 } };
  for (const k of events) {
    const train = real.filter((w) => w.facility !== k.facility);
    const m = fitMultinomial([...train.map((w) => w.x), ...synth.X], [...train.map((w) => w.y), ...synth.y]);
    const test = real.filter((w) => w.facility === k.facility).sort((a, b) => a.endUnix - b.endUnix);
    const cls = classIdx(k.category) as 1 | 2;
    let first: number | null = null;
    for (const w of test) {
      const p = predictProba(m, w.x);
      const fault = Math.max(p[1], p[2]);
      if (w.y === 0) {
        healthyN++;
        if (fault >= THRESHOLD) fp++;
      }
      if (w.event === k.id) {
        hit[cls].n++;
        if (p[cls] >= THRESHOLD) hit[cls].ok++;
      }
      // Lead: first window at/after (onset − 12 h) that crosses for the right class.
      if (first === null && w.endUnix >= k.onset_unix - EARLY_H * H && w.endUnix <= k.onset_unix + EARLY_H * H && p[cls] >= THRESHOLD) first = w.endUnix;
    }
    lead[k.id] = first === null ? null : Math.round((first - k.onset_unix) / 60);
  }
  const leads = Object.values(lead).filter((v): v is number => v !== null);
  return {
    lead_min_by_event: lead,
    median_lead_min: leads.length ? median(leads) : null,
    false_positive_rate: healthyN ? fp / healthyN : 0,
    recall: { pipeline_leak: hit[1].n ? hit[1].ok / hit[1].n : 0, pump_degradation: hit[2].n ? hit[2].ok / hit[2].n : 0 },
  };
}

function main() {
  const ds = load(FOLDER);
  const keyPath = path.join(ROOT, "fixtures", FOLDER, "answer_key.json");
  if (!existsSync(keyPath)) throw new Error("training needs fixtures/full_week/answer_key.json");
  const key: KeyEvent[] = JSON.parse(readFileSync(keyPath, "utf8"));
  const ctxs = facilityContexts(ds);
  const { windows, sigma } = realWindows(ds, ctxs, key);
  const dtH = (ds.ts[1] - ds.ts[0]) / H;
  const coupling = couplings(windows);
  const synth = generateSynthetic({ n: 3000, sigma, coupling, dtH, seed: 7 });
  const counts = [0, 1, 2].map((c) => windows.filter((w) => w.y === c).length);
  console.log(`real windows: healthy ${counts[0]}, leak ${counts[1]}, wear ${counts[2]}; synthetic ${synth.X.length}`);
  console.log(`measured sigma`, sigma, `coupling`, coupling);

  const metrics = evaluate(windows, synth, key);
  const fit = fitMultinomial([...windows.map((w) => w.x), ...synth.X], [...windows.map((w) => w.y), ...synth.y]);
  const out: EarlyWarningModel = {
    version: 1,
    trained_at: new Date().toISOString(),
    classes: CLASSES,
    features: FEATURE_NAMES,
    ...fit,
    threshold: THRESHOLD,
    metrics,
    provenance: {
      real_windows: windows.length,
      synthetic_windows: synth.X.length,
      folders: [FOLDER],
      notes: [
        "multinomial logistic regression on 8 baseline-relative window features (12 running samples)",
        `real labels from the answer key (training only); synthetic at measured noise σ recv ${sigma.recv.toFixed(4)}, flow ${sigma.flow.toFixed(4)}, pp ${sigma.pp.toFixed(1)}, dp ${sigma.dp.toFixed(1)}`,
        "evaluation: leave-one-event-out by facility; lead = minutes vs key onset (negative = before the labelled onset)",
      ],
    },
  };
  const lines = [
    "## Early-warning scorer",
    "",
    "| Metric | Value |",
    "|---|---|",
    `| real windows (healthy / leak / wear) | ${counts.join(" / ")} |`,
    `| synthetic windows | ${synth.X.length} |`,
    `| held-out false-positive rate (healthy windows ≥ ${THRESHOLD}) | ${(metrics.false_positive_rate * 100).toFixed(2)} % |`,
    `| held-out recall leak / wear (early-phase windows) | ${(metrics.recall.pipeline_leak * 100).toFixed(0)} % / ${(metrics.recall.pump_degradation * 100).toFixed(0)} % |`,
    `| median lead vs labelled onset | ${metrics.median_lead_min === null ? "n/a" : `${metrics.median_lead_min} min`} |`,
    "",
    "Lead per event (min, negative = fired before the labelled onset): " + Object.entries(metrics.lead_min_by_event).map(([k, v]) => `${k} ${v ?? "miss"}`).join(", "),
  ];
  const summary = lines.join("\n");
  console.log(summary);
  if (summaryPath) writeFileSync(summaryPath, summary + "\n");
  if (!dryRun) {
    writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
    console.log(`wrote ${path.relative(ROOT, OUT)}`);
  } else console.log("dry run: nothing written");
}

main();
