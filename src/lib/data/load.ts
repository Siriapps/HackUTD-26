import { seriesKey, type Dataset, type Network, type Ops } from "./types";

export interface DatasetInfo {
  folder: string;
  files: string[];
}

/** Folders that contain the three required files (served by /api/datasets). */
export async function listDatasets(): Promise<DatasetInfo[]> {
  const res = await fetch("/api/datasets", { cache: "no-store" });
  if (!res.ok) throw new Error(`datasets: ${res.status}`);
  return res.json();
}

/**
 * Parse telemetry.csv (`timestamp,ts_unix,asset_id,metric,value`, no quoting) into
 * aligned Float64Array series. Hand-rolled: ~400k rows parse in well under a second.
 * ponytail: main-thread parse; move to a Worker only if the loading UI janks.
 */
export function parseTelemetry(text: string): { ts: Int32Array; series: Map<string, Float64Array> } {
  // Pass 1: collect distinct timestamps (ascending in file) and series keys.
  const tsList: number[] = [];
  let lastTs = -1;
  const keys = new Set<string>();
  const lines = text.split("\n");
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const c1 = line.indexOf(",");
    const c2 = line.indexOf(",", c1 + 1);
    const c3 = line.indexOf(",", c2 + 1);
    const c4 = line.indexOf(",", c3 + 1);
    const tu = +line.slice(c1 + 1, c2);
    if (tu !== lastTs) {
      tsList.push(tu);
      lastTs = tu;
    }
    keys.add(line.slice(c2 + 1, c3) + "|" + line.slice(c3 + 1, c4));
  }
  const ts = Int32Array.from(tsList);
  const index = new Map<number, number>();
  ts.forEach((t, i) => index.set(t, i));
  const series = new Map<string, Float64Array>();
  for (const k of keys) series.set(k, new Float64Array(ts.length).fill(NaN));
  // Pass 2: fill.
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const c1 = line.indexOf(",");
    const c2 = line.indexOf(",", c1 + 1);
    const c3 = line.indexOf(",", c2 + 1);
    const c4 = line.indexOf(",", c3 + 1);
    const row = index.get(+line.slice(c1 + 1, c2))!;
    series.get(line.slice(c2 + 1, c3) + "|" + line.slice(c3 + 1, c4))![row] = +line.slice(c4 + 1);
  }
  return { ts, series };
}

export async function loadDataset(folder: string, onProgress?: (pct: number) => void): Promise<Dataset> {
  const base = `/data/${encodeURIComponent(folder)}`;
  const [network, ops, csv] = await Promise.all([
    fetch(`${base}/network.json`).then((r) => r.json() as Promise<Network>),
    fetch(`${base}/ops.json`).then((r) => r.json() as Promise<Ops>),
    fetchText(`${base}/telemetry.csv`, onProgress),
  ]);
  const { ts, series } = parseTelemetry(csv);
  return { folder, network, ops, ts, series, now: ts[ts.length - 1] };
}

async function fetchText(url: string, onProgress?: (pct: number) => void): Promise<string> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: ${res.status}`);
  const total = +(res.headers.get("content-length") ?? 0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (total && onProgress) onProgress(Math.min(99, Math.round((got / total) * 100)));
  }
  const merged = new Uint8Array(got);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.length;
  }
  onProgress?.(100);
  return new TextDecoder().decode(merged);
}

/** Convenience for tests and server code: build a Dataset from files on disk. */
export function datasetFromStrings(folder: string, network: Network, ops: Ops, csv: string): Dataset {
  const { ts, series } = parseTelemetry(csv);
  return { folder, network, ops, ts, series, now: ts[ts.length - 1] };
}

export { seriesKey };
