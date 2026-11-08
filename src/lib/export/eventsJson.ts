import type { Action, Analysis, Event } from "@/lib/data/types";
import { isoZ } from "@/components/format";

/** events.json in the shape fixtures/SPEC.md suggests. */
export interface EventsJsonRow {
  event_id: string;
  system_id: string;
  facility_id: string;
  asset_id: string;
  category: Event["category"];
  status: Event["status"];
  onset_ts: string;
  onset_unix: number;
  end_ts: string | null;
  end_unix: number | null;
  confidence: number;
  evidence: string[];
  level_pct?: number;
  hours_to_limit: { p50: number; p10?: number; p90?: number } | null;
  recommended_actions: Action[];
  est_cost?: number;
}

export function toEventsJson(analysis: Analysis): EventsJsonRow[] {
  return analysis.events.map((e) => {
    const ongoing = e.status === "ongoing";
    const actions = e.plan ? e.plan.recommended.actions : e.actions;
    const row: EventsJsonRow = {
      event_id: e.id,
      system_id: e.system,
      facility_id: e.facility,
      asset_id: e.asset,
      category: e.category,
      status: e.status,
      onset_ts: isoZ(e.onset_unix),
      onset_unix: e.onset_unix,
      end_ts: e.end_unix == null ? null : isoZ(e.end_unix),
      end_unix: e.end_unix,
      confidence: round(e.confidence, 2),
      evidence: e.evidence,
      hours_to_limit:
        ongoing && e.hours_to_limit
          ? { p50: round(e.hours_to_limit.p50, 2), p10: round(e.hours_to_limit.p10, 2), p90: round(e.hours_to_limit.p90, 2) }
          : null,
      recommended_actions: actions.length ? actions : [{ type: "none" }],
    };
    if (e.level_pct != null) row.level_pct = round(e.level_pct, 1);
    if (e.plan) row.est_cost = Math.round(e.plan.recommended.cost);
    return row;
  });
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

/** Browser download of the export. */
export function downloadEventsJson(analysis: Analysis) {
  const blob = new Blob([JSON.stringify(toEventsJson(analysis), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `events_${analysis.folder}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
