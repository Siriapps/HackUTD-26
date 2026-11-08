// Test-only helpers: read a dataset folder and its answer key from disk. Never imported by app code.
import { readFileSync } from "node:fs";
import path from "node:path";
import { lastIndexLE } from "../detect/stats";
import { datasetFromStrings } from "./load";
import { seriesKey, type Category, type Dataset } from "./types";

export function loadFixture(folder: string) {
  const dir = path.join(process.cwd(), "public", "data", folder);
  return datasetFromStrings(
    folder,
    JSON.parse(readFileSync(path.join(dir, "network.json"), "utf8")),
    JSON.parse(readFileSync(path.join(dir, "ops.json"), "utf8")),
    readFileSync(path.join(dir, "telemetry.csv"), "utf8"),
  );
}

export interface KeyEvent {
  id: string;
  system: string;
  facility: string;
  asset: string;
  category: Category;
  onset_unix: number;
  end_unix: number | null;
  status: "ongoing" | "resolved";
  reference_action: string;
  level_pct?: number;
  trips_at_unix?: number | null;
  level_final_pct?: number;
  hours_to_limit_final?: number;
  order?: number;
  lost_revenue_per_hour?: number;
}

export function loadKey(folder: string): KeyEvent[] {
  return JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", folder, "answer_key.json"), "utf8"));
}

function pumpStatus(ds: Dataset, facility: string): Float64Array {
  for (const s of ds.network.systems) for (const f of s.facilities) if (f.id === facility) return ds.series.get(seriesKey(f.pump.id, "status"))!;
  throw new Error(facility);
}

/**
 * A leak or wear is only observable while the pump runs. When the key's onset falls inside an
 * off period, the earliest honest onset is the first running sample at/after it (a wear ramp can
 * still be back-extrapolated to the true onset, so either is accepted).
 */
export function onsetMatches(ds: Dataset, k: KeyEvent, onset: number, tolMin = 15): boolean {
  const close = (t: number) => Math.abs(onset - t) <= tolMin * 60;
  if (close(k.onset_unix) || k.category === "pump_failure") return close(k.onset_unix);
  const st = pumpStatus(ds, k.facility);
  for (let i = lastIndexLE(ds.ts, k.onset_unix); i < ds.ts.length; i++) if (st[i] === 1) return close(Math.max(k.onset_unix, ds.ts[i]));
  return false;
}

/** The end of a drift is first visible at the next running sample (wear: or the pump's fault). */
export function endMatches(ds: Dataset, k: KeyEvent, end: number, tolMin = 15): boolean {
  if (k.category === "pump_failure") return end === k.end_unix;
  const st = pumpStatus(ds, k.facility);
  for (let i = Math.max(0, lastIndexLE(ds.ts, k.end_unix!)); i < ds.ts.length; i++) {
    if (st[i] === 1 || (st[i] === 2 && k.category === "pump_degradation")) return Math.abs(end - Math.max(k.end_unix!, ds.ts[i])) <= tolMin * 60;
  }
  return false;
}

/** Likewise, a drift that cleared while the pump was off cannot be known to have ended yet. */
export function observableStatus(ds: Dataset, k: KeyEvent): "ongoing" | "resolved" {
  if (k.status === "ongoing" || k.category === "pump_failure") return k.status;
  const st = pumpStatus(ds, k.facility);
  for (let i = Math.max(0, lastIndexLE(ds.ts, k.end_unix!)); i < ds.ts.length; i++) {
    if (st[i] === 1) return "resolved";
    if (st[i] === 2 && k.category === "pump_degradation") return "resolved"; // a failure ends wear
  }
  return "ongoing";
}
