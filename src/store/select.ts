/** Read-only lookups over Dataset / Analysis for the screens. No physics here: values are read, not derived. */
import { seriesKey, type Analysis, type Dataset, type Event, type Facility, type Metric, type System } from "@/lib/data/types";

export interface FacilityRef {
  facility: Facility;
  system: System;
}

const indexCache = new WeakMap<Dataset, Map<string, FacilityRef>>();
export function facilityIndex(ds: Dataset): Map<string, FacilityRef> {
  let m = indexCache.get(ds);
  if (!m) {
    m = new Map();
    for (const system of ds.network.systems) for (const facility of system.facilities) m.set(facility.id, { facility, system });
    indexCache.set(ds, m);
  }
  return m;
}

/** Index of the last sample at or before t; -1 before the first sample. */
export function tsIndex(ds: Dataset, t: number): number {
  const ts = ds.ts;
  let lo = 0;
  let hi = ts.length - 1;
  if (t < ts[0]) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ts[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function valueAt(ds: Dataset, asset: string, metric: Metric | string, t: number): number {
  const s = ds.series.get(seriesKey(asset, metric));
  if (!s) return NaN;
  const i = tsIndex(ds, t);
  return i < 0 ? NaN : s[i];
}

export interface Point {
  t: number;
  v: number;
}

/** Samples between from..to (inclusive), strided so at most `maxPoints` come back. */
export function seriesWindow(ds: Dataset, asset: string, metric: Metric | string, from: number, to: number, maxPoints = 700): Point[] {
  const s = ds.series.get(seriesKey(asset, metric));
  if (!s) return [];
  const i0 = Math.max(0, tsIndex(ds, from));
  const i1 = Math.max(i0, tsIndex(ds, to));
  const stride = Math.max(1, Math.ceil((i1 - i0 + 1) / maxPoints));
  const out: Point[] = [];
  for (let i = i0; i <= i1; i += stride) if (!Number.isNaN(s[i])) out.push({ t: ds.ts[i], v: s[i] });
  if ((i1 - i0) % stride !== 0 && !Number.isNaN(s[i1])) out.push({ t: ds.ts[i1], v: s[i1] });
  return out;
}

/** Every asset id at a facility with the metrics it reports, for the trend pickers. */
export function facilityAssets(ref: FacilityRef): { id: string; kind: string; metrics: Metric[] }[] {
  const f = ref.facility;
  return [
    { id: f.id, kind: "facility", metrics: ["inflow_bpd"] },
    { id: f.tank.id, kind: "tank", metrics: ["level_pct"] },
    { id: f.pump.id, kind: "pump", metrics: ["status", "flow_bpd", "discharge_psi"] },
    { id: f.pipeline.id, kind: "pipeline", metrics: ["receive_flow_bpd", "pressure_psi"] },
    ...f.wells.map((w) => ({ id: w.id, kind: "well", metrics: ["water_bpd", "status"] as Metric[] })),
  ];
}

export const UNIT: Record<Metric, string> = {
  inflow_bpd: "bpd",
  water_bpd: "bpd",
  status: "",
  level_pct: "%",
  flow_bpd: "bpd",
  discharge_psi: "psi",
  receive_flow_bpd: "bpd",
  pressure_psi: "psi",
};

export function ongoingAt(analysis: Analysis | null, facilityId: string): Event[] {
  return analysis?.alerts.filter((e) => e.facility === facilityId) ?? [];
}

export function eventsFor(analysis: Analysis | null, facilityId: string): Event[] {
  return analysis?.events.filter((e) => e.facility === facilityId) ?? [];
}

/** Lost production value if the whole facility shuts in, $/hr, from network wells and ops prices. */
export function facilityLostPerHr(ds: Dataset, f: Facility): number {
  const { oil_per_bbl, gas_per_mcf } = ds.ops.prices;
  return f.wells.reduce((n, w) => n + (w.oil_bpd * oil_per_bbl + w.gas_mcfd * gas_per_mcf) / 24, 0);
}
