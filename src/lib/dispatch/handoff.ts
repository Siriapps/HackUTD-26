// Morning handoff over iMessage: the console's handoff text (sensor picture) + what the night crew decided.
// Needs nothing from the tech: it's built from the analysis and the dispatch log.
import { handoffText } from "@/lib/export/handoff";
import { money } from "@/lib/format";
import { loadRoster, type Person } from "./roster";
import { textPeople } from "./send";
import { serverAnalysis, serverDataset, serverFolders } from "./server-data";
import { allAlerts, type OpenAlert } from "./store";

const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);

/** One line per alert the night crew handled, newest last. */
export function dispatchLog(alerts: OpenAlert[], sinceMs = 0): string[] {
  return alerts
    .filter((a) => a.sentAt >= sinceMs)
    .sort((a, b) => a.sentAt - b.sentAt)
    .map((a) => {
      const parts = [`${a.eventId}: alerted ${hhmm(a.sentAt)}`];
      if (a.choice && a.decidedAt) parts.push(`${a.choice.label} (${money(a.choice.cost)}) by ${a.decidedBy ?? "?"} ${hhmm(a.decidedAt)}`);
      if ((a.escalation ?? 0) > 0) parts.push(`escalated ×${a.escalation}`);
      if (a.status === "resolved" && a.resolution) {
        const notes = a.resolution.notes.length ? ` — "${a.resolution.notes.join(" / ")}"` : "";
        const pics = a.resolution.photos.length ? ` (${a.resolution.photos.length} photo${a.resolution.photos.length === 1 ? "" : "s"})` : "";
        parts.push(`fixed ${hhmm(a.resolution.at)} by ${a.resolution.by}${notes}${pics}`);
      } else if (a.status === "resolved") parts.push("resolved");
      else if (a.status === "awaiting") parts.push("⚠️ NO DECISION YET");
      else if (a.status === "escalated") parts.push("⚠️ tech asked for help");
      return `• ${parts.join("; ")}`;
    });
}

export function composeHandoff(consoleText: string, alerts: OpenAlert[], sinceMs = 0) {
  const log = dispatchLog(alerts, sinceMs);
  return [consoleText.trim(), "", log.length ? "Overnight dispatch:" : "No alerts were dispatched overnight.", ...log].join("\n").trim();
}

/** Morning crew from the roster, or DISPATCH_HANDOFF_HANDLE (comma-separated) for demos. */
export async function morningCrew(): Promise<Person[]> {
  const env = process.env.DISPATCH_HANDOFF_HANDLE?.split(",").map((h) => h.trim()).filter(Boolean);
  if (env?.length) return env.map((handle, i) => ({ name: `Morning crew ${i + 1}`, role: "day_lead", channel: "imessage", handle }));
  const r = await loadRoster();
  return r.source === "example" ? [] : r.morning_crew;
}

/** Send the handoff. `consoleText` comes from the dashboard; without it, it's built server-side for `folder`. */
export async function sendHandoff(opts: { consoleText?: string; folder?: string; asOf?: number; sinceMs?: number; dryRun?: boolean }) {
  let consoleText = opts.consoleText;
  if (!consoleText) {
    const folder = opts.folder || allAlerts()[0]?.folder || (await serverFolders()).at(-1);
    if (!folder) return { ok: false as const, error: "no dataset folders" };
    const [analysis, dataset] = await Promise.all([serverAnalysis(folder, opts.asOf), serverDataset(folder)]);
    consoleText = handoffText(analysis, dataset);
  }
  const text = composeHandoff(consoleText, allAlerts(), opts.sinceMs ?? Date.now() - 24 * 3_600_000);
  const crew = await morningCrew();
  if (opts.dryRun || !crew.length) {
    return { ok: true as const, sent: [] as string[], failed: [] as string[], text, reason: opts.dryRun ? "dryRun" : "no morning crew (roster or DISPATCH_HANDOFF_HANDLE)" };
  }
  const day = new Date().toISOString().slice(0, 10);
  const r = await textPeople(crew, text, `handoff:${day}:${text.length}`);
  return { ok: true as const, ...r, text };
}
