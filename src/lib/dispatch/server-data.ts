// Server-side dataset access for dispatch: reads public/data/<folder> from disk once, and runs analyse()
// per (folder, asOf). `asOf` is the operator's time-travel "now" so an alert sent from the past stays true.
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { analyse } from "@/lib/analyse";
import { datasetFromStrings } from "@/lib/data/load";
import type { Analysis, Dataset } from "@/lib/data/types";
import { FIXTURES } from "@/lib/memory/fixture";

const ROOT = path.join(process.cwd(), "public", "data");
const REQUIRED = ["network.json", "ops.json", "telemetry.csv"];
const MAX_ANALYSES = 12;
const datasets = new Map<string, Promise<Dataset>>();
const analyses = new Map<string, Promise<Analysis>>();

const safe = (folder: string) => {
  if (!/^[\w.-]+$/.test(folder)) throw new Error(`bad folder ${folder}`);
  return path.join(ROOT, folder);
};

export async function serverFolders(): Promise<string[]> {
  const dirs = await readdir(ROOT, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const files = await readdir(path.join(ROOT, d.name)).catch(() => [] as string[]);
    if (REQUIRED.every((f) => files.includes(f))) out.push(d.name);
  }
  return out.sort();
}

export function serverDataset(folder: string): Promise<Dataset> {
  let p = datasets.get(folder);
  if (!p) {
    const dir = safe(folder);
    p = Promise.all(REQUIRED.map((f) => readFile(path.join(dir, f), "utf8"))).then(([n, o, csv]) =>
      datasetFromStrings(folder, JSON.parse(n), JSON.parse(o), csv),
    );
    p.catch(() => datasets.delete(folder));
    datasets.set(folder, p);
  }
  return p;
}

export function serverAnalysis(folder: string, asOf?: number): Promise<Analysis> {
  const key = `${folder}|${asOf ?? "end"}`;
  let p = analyses.get(key);
  if (!p) {
    p = serverDataset(folder).then((ds) => analyse(ds, asOf != null && asOf < ds.now ? asOf : undefined));
    p.catch(() => analyses.delete(key));
    analyses.set(key, p);
    if (analyses.size > MAX_ANALYSES) analyses.delete(analyses.keys().next().value!);
  }
  return p;
}

/**
 * The latest analysis of one event, or null when it cannot be loaded. Built-in fixtures (folder "fixture") have no
 * dataset directory, and a thread can outlive its folder; neither may crash the caller with a file error.
 */
export async function serverEvent(folder: string, eventId: string, asOf?: number) {
  const fixture = FIXTURES[eventId];
  if (fixture && (folder === fixture.folder || !folder)) {
    return { event: fixture.event, now: fixture.now, fleet: fixture.fleet };
  }
  try {
    const a = await serverAnalysis(folder, asOf);
    const event = a.events.find((e) => e.id === eventId);
    return event ? { event, now: a.now, fleet: a.fleet[event.system] } : null;
  } catch (err) {
    console.warn(`[dispatch] cannot load ${folder}/${eventId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}
