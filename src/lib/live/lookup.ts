/**
 * Event-id lookup for glasses sessions: the technician types an id in the phone app; the server decides whether
 * it names a known event (attach the call to it) or a new one (open an ad-hoc thread).
 *
 * Search order: fixtures → the folder the phone asked for → every other dataset folder (newest name first),
 * preferring a dataset where the event is still ongoing. Folders that cannot be read are skipped, never fatal.
 */
import { serverAnalysis, serverDataset, serverFolders } from "@/lib/dispatch/server-data";
import { eventContext, type EventContext } from "@/lib/events";
import { FIXTURES } from "@/lib/memory/fixture";

export const normalizeEventId = (raw: string) => raw.trim().toUpperCase();

async function inFolder(folder: string, eventId: string): Promise<EventContext | null> {
  try {
    const [dataset, analysis] = await Promise.all([serverDataset(folder), serverAnalysis(folder)]);
    const event = analysis.events.find((e) => e.id === eventId);
    return event ? eventContext(dataset, analysis, event) : null;
  } catch {
    return null;
  }
}

/** The event's context, or null when no dataset has it (a new, ad-hoc incident). */
export async function findEventContext(rawEventId: string, folder?: string): Promise<EventContext | null> {
  const eventId = normalizeEventId(rawEventId);
  const fixture = FIXTURES[eventId] ?? Object.values(FIXTURES).find((f) => f.event.id.toUpperCase() === eventId);
  if (fixture) return fixture;

  if (folder) {
    const hit = await inFolder(folder, eventId);
    if (hit) return hit;
  }
  const folders = (await serverFolders()).filter((f) => f !== folder).sort().reverse();
  let firstMatch: EventContext | null = null;
  for (const f of folders) {
    const hit = await inFolder(f, eventId);
    if (!hit) continue;
    if (hit.event.status === "ongoing") return hit;
    firstMatch ??= hit;
  }
  return firstMatch;
}
