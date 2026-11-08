/**
 * "What actually happened" for the timeline: read straight from the telemetry after an event's onset.
 * Peak tank level, when the wells were shut in (facility inflow went to 0) and when they resumed.
 */
import { seriesKey, type Dataset, type Event } from "@/lib/data/types";
import { facilityIndex, tsIndex } from "./select";

export interface Outcome {
  /** Window actually inspected (onset → repair end, capped at the folder's last sample). */
  from: number;
  to: number;
  peak_pct: number | null;
  peak_at: number | null;
  shut_in_at: number | null;
  resumed_at: number | null;
  /** True when the folder ends before the window does: the outcome is still being written. */
  truncated: boolean;
}

export function actualOutcome(ds: Dataset, e: Event): Outcome {
  const ref = facilityIndex(ds).get(e.facility);
  const repairEnd = e.onset_unix + ds.ops.expected_repair_hours.pump_failure * 3600;
  const wanted = e.end_unix ?? repairEnd;
  const to = Math.min(wanted, ds.now);
  const out: Outcome = { from: e.onset_unix, to, peak_pct: null, peak_at: null, shut_in_at: null, resumed_at: null, truncated: to < wanted };
  if (!ref) return out;
  const i0 = Math.max(0, tsIndex(ds, e.onset_unix));
  const i1 = tsIndex(ds, to);
  const level = ds.series.get(seriesKey(ref.facility.tank.id, "level_pct"));
  const inflow = ds.series.get(seriesKey(ref.facility.id, "inflow_bpd"));
  for (let i = i0; i <= i1; i++) {
    const l = level?.[i];
    if (l != null && !Number.isNaN(l) && (out.peak_pct == null || l > out.peak_pct)) {
      out.peak_pct = l;
      out.peak_at = ds.ts[i];
    }
    const q = inflow?.[i];
    if (q != null && !Number.isNaN(q)) {
      if (out.shut_in_at == null && q <= 0) out.shut_in_at = ds.ts[i];
      else if (out.shut_in_at != null && out.resumed_at == null && q > 0) out.resumed_at = ds.ts[i];
    }
  }
  return out;
}
