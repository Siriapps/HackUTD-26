// Server-side dataset access for dispatch: reads public/data/<folder> from disk and runs analyse() once per folder.
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { analyse } from "@/lib/analyse";
import { datasetFromStrings } from "@/lib/data/load";
import type { Analysis } from "@/lib/data/types";

const ROOT = path.join(process.cwd(), "public", "data");
const REQUIRED = ["network.json", "ops.json", "telemetry.csv"];
const cache = new Map<string, Promise<Analysis>>();

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

export function serverAnalysis(folder: string): Promise<Analysis> {
  let p = cache.get(folder);
  if (!p) {
    const dir = safe(folder);
    p = Promise.all(REQUIRED.map((f) => readFile(path.join(dir, f), "utf8"))).then(([n, o, csv]) =>
      analyse(datasetFromStrings(folder, JSON.parse(n), JSON.parse(o), csv)),
    );
    p.catch(() => cache.delete(folder));
    cache.set(folder, p);
  }
  return p;
}

export async function serverEvent(folder: string, eventId: string) {
  const a = await serverAnalysis(folder);
  const event = a.events.find((e) => e.id === eventId);
  return event ? { event, now: a.now, fleet: a.fleet[event.system] } : null;
}
