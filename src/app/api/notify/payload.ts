import type { Category, Event } from "@/lib/data/types";
import { hoursText, money, pct, utc } from "@/lib/format";
import { CATEGORY_LABEL } from "@/lib/memory/incidents";

export type NotifyKind = "alert" | "confirmation" | "observation" | "escalation" | "resolution";

/** POST /api/notify body (W2's dispatch button and the field page both send this). */
export interface NotifyBody {
  event: Event;
  folder?: string;
  kind?: NotifyKind;
  /** Free text for non-alert kinds (escalation reason, observation, resolution). */
  note?: string;
}

export const CATEGORY_COLOR: Record<Category, number> = { pump_failure: 0xf5a524, pipeline_leak: 0x27d3ee, pump_degradation: 0xa78bfa };
const KIND_TITLE: Record<NotifyKind, string> = {
  alert: "",
  confirmation: "Plan confirmed",
  observation: "Field observation",
  escalation: "Escalation",
  resolution: "Resolved",
};

const actionText = (a: Event["actions"][number]) =>
  a.type === "dispatch_truck"
    ? `${a.trucks} truck${a.trucks === 1 ? "" : "s"} × ${a.trips_per_truck} trip${a.trips_per_truck === 1 ? "" : "s"} to ${a.facility_id}`
    : a.type === "shut_in_wells"
      ? `Shut in ${a.wells.join(", ")} at +${a.start_after_min} min`
      : a.type === "field_inspection"
        ? `Inspect ${a.asset_id}`
        : "Do nothing";

/** Discord webhook payload: one embed in the category colour with deep links into the console. */
export function buildPayload(event: Event, folder: string, origin: string, kind: NotifyKind, note?: string) {
  const q = folder ? `?folder=${encodeURIComponent(folder)}` : "";
  const fieldUrl = `${origin}/field/${encodeURIComponent(event.id)}${q}`;
  const facilityUrl = `${origin}/facility/${encodeURIComponent(event.facility)}${q}`;
  const plan = event.plan?.recommended;
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
  if (event.hours_to_limit) {
    fields.push({
      name: "Shutdown in",
      value: `${hoursText(event.hours_to_limit.p50)} (${event.hours_to_limit.p10.toFixed(1)}–${event.hours_to_limit.p90.toFixed(1)} h)`,
      inline: true,
    });
  }
  if (event.level_pct != null) fields.push({ name: "Tank now", value: pct(event.level_pct), inline: true });
  if (event.lost_revenue_per_hr != null) fields.push({ name: "At stake", value: `${money(event.lost_revenue_per_hr)}/h`, inline: true });
  fields.push(
    plan
      ? { name: `Plan — ${money(plan.cost)}`, value: `${plan.label}\n${plan.actions.map(actionText).join("\n")}` }
      : { name: "Action", value: event.actions.map(actionText).join("\n") || "Field inspection" },
  );
  const alts = event.plan?.alternatives.slice(0, 3) ?? [];
  if (alts.length) fields.push({ name: "Also considered", value: alts.map((o) => `${o.label} — ${money(o.cost)}${o.feasible ? "" : " (tank trips)"}`).join("\n") });
  if (event.evidence.length) fields.push({ name: "Evidence", value: event.evidence.map((e) => `• ${e}`).join("\n").slice(0, 1024) });
  fields.push({ name: "Open", value: `[Field view](${fieldUrl}) · [Facility](${facilityUrl})` });

  return {
    username: "Avon Night Shift",
    embeds: [
      {
        title: `${kind === "alert" ? "" : `${KIND_TITLE[kind]}: `}${CATEGORY_LABEL[event.category]} — ${event.facility}`,
        url: fieldUrl,
        color: kind === "escalation" ? 0xfb7185 : CATEGORY_COLOR[event.category],
        description: note?.trim() || `${event.asset} · since ${utc(event.onset_unix)} · confidence ${Math.round(event.confidence * 100)} %`,
        fields,
        footer: { text: `${event.id}${folder ? ` · ${folder}` : ""}` },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}
