// What the phone agent knows when a technician calls: their open alerts, each with the same facts the field
// page's Gemini session gets (readings, countdown, plan + alternatives, runbook, similar past incidents),
// plus what the night crew already did on the iMessage thread.
import { eventContext } from "@/lib/events";
import { handoffText } from "@/lib/export/handoff";
import { buildBriefing, CATEGORY_LABEL, similar } from "@/lib/memory";
import { composeStatus } from "@/lib/dispatch/alert";
import { serverAnalysis, serverDataset, serverFolders } from "@/lib/dispatch/server-data";
import { allAlerts, type OpenAlert } from "@/lib/dispatch/store";
import { hoursText, money } from "@/lib/format";

/** Last 10 digits, so "+1 (555) 010-0199" and "+15550100199" match. */
export const phoneKey = (h?: string | null) => (h ?? "").replace(/\D/g, "").slice(-10);

/** The caller's open alerts (as on-call tech or paged supervisor); everyone's if we don't know the number. */
export function callerAlerts(caller?: string | null): { alerts: OpenAlert[]; role: "tech" | "supervisor" | "unknown" } {
  const open = allAlerts().filter((a) => a.status !== "resolved");
  const k = phoneKey(caller);
  if (k) {
    const mine = open.filter((a) => phoneKey(a.handle) === k);
    if (mine.length) return { alerts: mine, role: "tech" };
    const watching = open.filter((a) => (a.watchers ?? []).some((w) => phoneKey(w.handle) === k));
    if (watching.length) return { alerts: watching, role: "supervisor" };
  }
  return { alerts: open, role: "unknown" };
}

/** Pick the alert a tool call is about: explicit id, else the caller's only open alert. */
export function resolveAlert(caller: string | undefined, eventId?: string): OpenAlert | string {
  const { alerts } = callerAlerts(caller);
  const id = eventId?.trim().toUpperCase().replace(/^EV[\s#-]*0*(\d+)$/, (_, n) => `EV-${String(n).padStart(4, "0")}`);
  if (id) return alerts.find((a) => a.eventId === id) ?? allAlerts().find((a) => a.eventId === id) ?? `No alert ${id}. Open: ${alerts.map((a) => a.eventId).join(", ") || "none"}.`;
  if (alerts.length === 1) return alerts[0];
  if (!alerts.length) return "No open alerts right now.";
  return `Several open alerts: ${alerts.map((a) => a.eventId).join(", ")}. Ask which one.`;
}

/** Facts for one alert: the field briefing's data section + what's been decided so far. */
export async function alertFacts(a: OpenAlert): Promise<string | null> {
  const [analysis, dataset] = await Promise.all([serverAnalysis(a.folder, a.asOf), serverDataset(a.folder)]);
  const event = analysis.events.find((e) => e.id === a.eventId);
  if (!event) return null;
  const ctx = eventContext(dataset, analysis, event);
  const full = buildBriefing(ctx, [...fieldIncidents(event.category), ...similar(event, analysis)].slice(0, 4));
  // Drop the Gemini camera persona/tool lines; keep the facts from FACILITY onward.
  const lines = full.split("\n");
  const start = lines.findIndex((l) => l.startsWith("FACILITY "));
  const decided = a.choice
    ? `DECIDED: ${a.choice.label} (${money(a.choice.cost)}) by ${a.decidedBy ?? "?"}; status ${a.status}.`
    : `DECIDED: nothing yet; status ${a.status}${a.ackAt ? " (tech acknowledged)" : ""}.`;
  return [`=== ${a.eventId} ===`, decided, ...lines.slice(Math.max(0, start))].join("\n");
}

/** Resolutions the field texted in tonight, as extra "past incidents" (newest knowledge first). */
function fieldIncidents(category: string) {
  return allAlerts()
    .filter((a) => a.resolution?.notes.length)
    .map((a) => ({
      id: `field-${a.key}`,
      source: "field" as const,
      category: category as never,
      system: "",
      summary: `${a.eventId} tonight`,
      outcome: `fixed by ${a.resolution!.by}: ${a.resolution!.notes.join(" / ")}`,
    }));
}

export interface CallBrief {
  role: "tech" | "supervisor" | "unknown";
  alerts: OpenAlert[];
  /** Long context for the agent prompt. */
  briefing: string;
  /** One-line opener the agent says first. */
  firstMessage: string;
}

export async function briefFor(caller?: string | null): Promise<CallBrief> {
  const { alerts, role } = callerAlerts(caller);
  const facts = (await Promise.all(alerts.slice(0, 3).map((a) => alertFacts(a).catch(() => null)))).filter(Boolean) as string[];

  if (!alerts.length) {
    const folder = (await serverFolders()).at(-1);
    let overview = "No dataset loaded.";
    if (folder) {
      const [an, ds] = await Promise.all([serverAnalysis(folder), serverDataset(folder)]);
      overview = handoffText(an, ds);
    }
    return {
      role,
      alerts,
      briefing: `No alerts are dispatched to this caller. Network picture:\n${overview}`,
      firstMessage: "Avon night engineering. No alerts are open for you right now. What's going on?",
    };
  }

  const first = alerts[0];
  const ev = (await serverAnalysis(first.folder, first.asOf)).events.find((e) => e.id === first.eventId);
  const what = ev ? `${CATEGORY_LABEL[ev.category].toLowerCase()} at ${ev.facility}` : first.eventId;
  const htl = ev?.hours_to_limit?.p50;
  const clock = htl != null ? `, about ${hoursText(htl)} to shutdown` : "";
  const more = alerts.length > 1 ? ` You have ${alerts.length} open alerts; I'll start with the most urgent.` : "";
  const rec = ev?.plan?.recommended;
  const planSay = rec ? ` This is the plan, and it's the cheapest option: ${rec.label}, ${money(rec.cost)}.` : "";
  return {
    role,
    alerts,
    briefing: facts.join("\n\n"),
    firstMessage: `Avon night engineering. I've got ${first.eventId}, the ${what}${clock}.${planSay}${more} Are you on site, and is the area safe?`,
  };
}

/** Short spoken status for one alert (get_status tool). */
export async function spokenStatus(a: OpenAlert) {
  const analysis = await serverAnalysis(a.folder, a.asOf);
  const ev = analysis.events.find((e) => e.id === a.eventId);
  if (!ev) return `${a.eventId}: no longer in the analysis.`;
  return composeStatus(ev, analysis.now, a.choice ? `${a.status} by ${a.decidedBy ?? "?"}: ${a.choice.label}` : a.status);
}
