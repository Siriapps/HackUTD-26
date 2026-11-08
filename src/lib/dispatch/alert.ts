// Text of the night-shift alert and its follow-ups. Every number comes from the Event / Analysis.
import type { Action, Event, PlanOption } from "@/lib/data/types";
import { hoursText, money, pct, utc } from "@/lib/format";

const LABEL: Record<Event["category"], string> = {
  pump_failure: "PUMP FAILURE",
  pipeline_leak: "PIPELINE LEAK",
  pump_degradation: "PUMP WEARING",
};
const ICON: Record<Event["category"], string> = { pump_failure: "🟠", pipeline_leak: "🔵", pump_degradation: "🟣" };

export interface AlertCtx {
  /** Dataset "now" (unix s). */
  now: number;
  folder: string;
  baseUrl?: string;
  /** Trucks this system has / has committed, for the shared-fleet line. */
  fleet?: { size: number; committed: number };
  /** Night-engineer phone line; when set the text invites the tech to call instead of ringing them. */
  voiceNumber?: string;
}

export const callLine = (n?: string) => (n ? `Or call ${n} any time to talk it through with the night engineer.` : null);

export const hasAction = (o: PlanOption, t: Action["type"]) => o.actions.some((a) => a.type === t);

/**
 * Cheapest feasible option of a kind: pure trucks / pure shut-in first, else any option that includes it
 * (a mix) — so "TRUCKS" on a mixed recommendation means "trucks only, no shut-in" when that's possible.
 */
export function cheapestOf(event: Event, kind: "trucks" | "shutin"): PlanOption | undefined {
  const plan = event.plan;
  if (!plan) return undefined;
  const want: Action["type"] = kind === "trucks" ? "dispatch_truck" : "shut_in_wells";
  const other: Action["type"] = kind === "trucks" ? "shut_in_wells" : "dispatch_truck";
  const feasible = [plan.recommended, ...plan.alternatives].filter((o) => o.feasible && hasAction(o, want));
  const byCost = (a: PlanOption, b: PlanOption) => a.cost - b.cost;
  return feasible.filter((o) => !hasAction(o, other)).sort(byCost)[0] ?? feasible.sort(byCost)[0];
}

export function fieldLink(event: Event, ctx: AlertCtx) {
  const base = (ctx.baseUrl ?? "").replace(/\/$/, "");
  return `${base}/field/${encodeURIComponent(event.id)}?folder=${encodeURIComponent(ctx.folder)}`;
}

export function countdownLine(event: Event, now: number) {
  const h = event.hours_to_limit;
  if (!h) return null;
  if (h.p50 <= 0) return `Tank at shutdown now (${pct(event.level_pct ?? 0)}).`;
  const at = utc(now + h.p50 * 3600);
  const spread = h.p50 - h.p10 >= 1 / 6 ? ` (earliest ${hoursText(h.p10)})` : "";
  return `Tank ${pct(event.level_pct ?? 0)} → shutdown in ${hoursText(h.p50)} at ${at}${spread}.`;
}

export function optionLine(o: PlanOption) {
  return `${o.label}: ${money(o.cost)}${o.feasible ? "" : " (tank still trips)"}`;
}

/** The first message to the on-call tech. Short enough to read on a lock screen. */
export function composeAlert(event: Event, ctx: AlertCtx): string {
  const lines = [`${ICON[event.category]} ${LABEL[event.category]} ${event.id} · ${event.facility} (${event.system})`];
  const cd = countdownLine(event, ctx.now);
  if (cd) lines.push(cd);
  if (event.evidence[0]) lines.push(event.evidence[0]);

  const plan = event.plan;
  if (plan) {
    const rec = plan.recommended;
    lines.push("", `PLAN: ${optionLine(rec)}`);
    const alt = (["trucks", "shutin"] as const)
      .map((k) => cheapestOf(event, k))
      .filter((o): o is PlanOption => !!o && o !== rec);
    const doNothing = plan.alternatives.find((o) => o.actions.every((a) => a.type === "none"));
    for (const o of alt) lines.push(`ALT: ${optionLine(o)}`);
    if (doNothing && doNothing !== rec && doNothing.trips_at_unix) {
      lines.push(`Do nothing: tank trips at ${utc(doNothing.trips_at_unix)}, ${money(event.lost_revenue_per_hr ?? 0)}/hr lost.`);
    }
    if (ctx.fleet && plan.trucks_used) lines.push(`Fleet ${event.system}: ${ctx.fleet.committed}/${ctx.fleet.size} trucks committed.`);
    lines.push("", "Reply YES to approve · NO for options · TRUCKS or SHUT to switch · ? for status · HELP");
  } else {
    lines.push("", `ACTION: inspect ${event.asset}.`, "Reply YES to acknowledge · FIXED when cleared · HELP");
  }
  const call = callLine(ctx.voiceNumber);
  if (call) lines.push(call);
  lines.push(fieldLink(event, ctx));
  return lines.join("\n");
}

export function composeOptions(event: Event): string {
  const plan = event.plan;
  if (!plan) return `${event.id}: no plan alternatives (inspection only).`;
  const all = [plan.recommended, ...plan.alternatives].slice(0, 5);
  return [
    `${event.id} options:`,
    ...all.map((o, i) => `${i + 1}) ${optionLine(o)}${i === 0 ? " ← recommended" : ""}`),
    `Reply OPT n${all.length > 1 ? ` (1-${all.length})` : ""}, or ${event.id} YES for the recommendation.`,
  ].join("\n");
}

export function composeStatus(event: Event, now: number, decision?: string): string {
  const lines = [`${event.id} ${LABEL[event.category]} ${event.facility}`];
  const cd = countdownLine(event, now);
  if (cd) lines.push(cd);
  if (event.status === "resolved") lines.push("Sensors show this resolved.");
  if (decision) lines.push(`Decision: ${decision}`);
  return lines.join("\n");
}
