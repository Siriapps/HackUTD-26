import { seriesKey, type Dataset, type Event, type Facility, type Network, type Plan, type System } from "@/lib/data/types";
import type { TwinReadings, TwinTrucking } from "./types";

/** Index of the last sample at or before `t`; -1 before the first sample. */
export function indexAt(ts: Int32Array, t: number): number {
  let lo = 0;
  let hi = ts.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

function valueAt(ds: Dataset, key: string, i: number): number {
  const s = ds.series.get(key);
  const v = s && i >= 0 ? s[i] : NaN;
  return Number.isFinite(v) ? v : 0;
}

/** Sample every twin-relevant series of a facility at `t` (last reading at or before `t`). */
export function readingsAt(ds: Dataset, f: Facility, t: number): TwinReadings {
  const i = indexAt(ds.ts, t);
  return {
    level_pct: valueAt(ds, seriesKey(f.tank.id, "level_pct"), i),
    pump_status: valueAt(ds, seriesKey(f.pump.id, "status"), i),
    flow_bpd: valueAt(ds, seriesKey(f.pump.id, "flow_bpd"), i),
    discharge_psi: valueAt(ds, seriesKey(f.pump.id, "discharge_psi"), i),
    receive_flow_bpd: valueAt(ds, seriesKey(f.pipeline.id, "receive_flow_bpd"), i),
    pressure_psi: valueAt(ds, seriesKey(f.pipeline.id, "pressure_psi"), i),
    inflow_bpd: valueAt(ds, seriesKey(f.id, "inflow_bpd"), i),
  };
}

export function findFacility(network: Network, facilityId: string): { system: System; facility: Facility } | null {
  for (const system of network.systems) {
    const facility = system.facilities.find((f) => f.id === facilityId);
    if (facility) return { system, facility };
  }
  return null;
}

export const eventActiveAt = (e: Event, t: number) => t >= e.onset_unix && (e.end_unix == null || t < e.end_unix);

/** Tank level under the recommended plan at `t` (linear between curve points); null outside the plan's curve. */
export function planLevelAt(plan: Plan, t: number): number | null {
  const c = plan.recommended.curve;
  if (!c.length || t < c[0].t_unix || t > c[c.length - 1].t_unix) return null;
  let lo = 0;
  let hi = c.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (c[mid].t_unix <= t) lo = mid;
    else hi = mid - 1;
  }
  const a = c[lo];
  const b = c[Math.min(lo + 1, c.length - 1)];
  if (b.t_unix === a.t_unix) return a.level_pct;
  return a.level_pct + ((b.level_pct - a.level_pct) * (t - a.t_unix)) / (b.t_unix - a.t_unix);
}

/**
 * Truck arrival waves implied by a plan: every truck is called at plan start, arrives `response_min` later and
 * again every `cycle_min` for each further trip. Plan start = first point of the recommended curve (onset for
 * historical plans, "now" for live ones), falling back to the event onset.
 */
export function truckSchedule(plan?: Plan, event?: Event, trucking?: TwinTrucking): { trucks: number; arrivals: number[] } {
  const none = { trucks: 0, arrivals: [] as number[] };
  if (!plan || !trucking) return none;
  let trucks = 0;
  let trips = 0;
  for (const a of plan.recommended.actions) {
    if (a.type === "dispatch_truck") {
      trucks += a.trucks;
      trips = Math.max(trips, a.trips_per_truck);
    }
  }
  const start = plan.recommended.curve[0]?.t_unix ?? event?.onset_unix;
  if (!trucks || !trips || start == null) return none;
  const arrivals = Array.from({ length: trips }, (_, k) => start + (trucking.response_min + k * trucking.cycle_min) * 60);
  return { trucks, arrivals };
}
