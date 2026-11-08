/**
 * Server-side ingest for Live Incident Response events (shared by /api/live/events and /api/live/confirm).
 *
 *   validate envelope → (dedupe) → applyEvent against the in-memory snapshot → persist to Tiger → SSE fan-out
 *
 * The in-memory snapshot (hub.getLive) is authoritative and updated synchronously, so concurrent events
 * cannot overwrite each other and the page works without a database. Tiger is the restart-proof copy.
 */
import { findEventContext } from "./lookup";
import { GENERAL } from "./processor";
import { loadLive, saveLive } from "@/lib/db/incidents";
import { getLive, hasSeen, publish, setLive } from "./hub";
import { applyEvent } from "./processor";
import type { LiveEvent, LiveEventType } from "./types";

export interface IngestResult {
  duplicate: boolean;
  accepted: boolean;
  /** Present for tool-driven events so the phone can tell Gemini what really happened. */
  result?: { ok: boolean; message: string };
}

/**
 * Category of the incident from the server's own data. "general" when no dataset has the event (a new, ad-hoc
 * incident); undefined only when the lookup itself failed, so the caller can fall back safely.
 */
export async function resolveCategory(folder: string, eventId: string): Promise<string | undefined> {
  try {
    const ctx = await findEventContext(eventId, folder || undefined);
    return ctx ? ctx.event.category : GENERAL;
  } catch {
    return undefined;
  }
}

const STATEFUL = (t: string) => !t.startsWith("transcript.");

export async function ingest(ev: LiveEvent): Promise<IngestResult> {
  if (hasSeen(ev.folder, ev.eventId, ev.id)) return { duplicate: true, accepted: true };

  if (!STATEFUL(ev.type)) {
    publish(ev);
    return { duplicate: false, accepted: true };
  }

  const needsHint = ev.type === "session.start" || !getLive(ev.folder, ev.eventId);
  const hint = needsHint ? await resolveCategory(ev.folder, ev.eventId) : undefined;

  // Restart recovery: pull the persisted snapshot once if memory has none.
  let existing = getLive(ev.folder, ev.eventId);
  if (!existing && ev.type !== "session.start") {
    const persisted = await loadLive(ev.folder, ev.eventId).catch((err) => {
      console.error("[live/ingest] loadLive failed:", err instanceof Error ? err.message : err);
      return null;
    });
    existing = getLive(ev.folder, ev.eventId) ?? persisted;
  }

  // Synchronous from here to setLive: no await, so two events cannot interleave.
  const applied = applyEvent(ev, existing, hint);
  if (!applied.accepted) {
    return { duplicate: false, accepted: false, result: applied.toolResult ? { ok: applied.toolResult.ok, message: applied.toolResult.message } : undefined };
  }
  setLive(ev.folder, ev.eventId, applied.live);
  saveLive(ev.folder, ev.eventId, applied.live);

  publish({ ...ev, type: ev.type as LiveEventType, payload: applied.publishPayload ?? ev.payload });
  applied.derivedNotes.forEach((n, i) => {
    publish({ ...ev, id: `${ev.id}#note${i}`, type: "note.append", payload: { kind: n.kind, text: n.text } });
  });

  return {
    duplicate: false,
    accepted: true,
    result: applied.toolResult ? { ok: applied.toolResult.ok, message: applied.toolResult.message } : undefined,
  };
}
