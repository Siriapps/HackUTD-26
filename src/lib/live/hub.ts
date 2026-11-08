/**
 * In-process event hub for the Live Incident Response pipeline.
 *
 * iOS → POST /api/live/events → hub.publish() → SSE fans out to browsers.
 *
 * Key properties:
 * - Duplicate event ids are ignored (idempotent ingest).
 * - Partials are held in-memory and NOT added to the durable log.
 * - Finals are stored and replayed to late-joining SSE clients (afterSeq).
 * - Per-incident key: `${folder}|${eventId}`.
 *
 * The hub is a singleton so it survives across Next.js request handlers in the same process.
 * After a process restart clients reconnect; GET /api/live/state rebuilds from Tiger.
 */

import type { LiveEvent, TranscriptPayload } from "./types";

export type Subscriber = (event: LiveEvent) => void;

interface IncidentState {
  /** Deduplication set. */
  seen: Set<string>;
  /** All non-partial events in seq order (for afterSeq replay). */
  log: LiveEvent[];
  subscribers: Set<Subscriber>;
  /** Open partial lines keyed by turnId (not stored in log). */
  partials: Map<string, LiveEvent>;
  /** Highest seq received. */
  maxSeq: number;
}

const store = new Map<string, IncidentState>();

function key(folder: string, eventId: string): string {
  return `${folder}|${eventId}`;
}

function getOrCreate(folder: string, eventId: string): IncidentState {
  const k = key(folder, eventId);
  let s = store.get(k);
  if (!s) {
    s = { seen: new Set(), log: [], subscribers: new Set(), partials: new Map(), maxSeq: -1 };
    store.set(k, s);
  }
  return s;
}

/** Publish a LiveEvent from the iOS ingest route. Returns false if it was a duplicate. */
export function publish(event: LiveEvent): boolean {
  const s = getOrCreate(event.folder, event.eventId);

  // Idempotent: same id → ignore.
  if (s.seen.has(event.id)) return false;
  s.seen.add(event.id);

  if (event.seq > s.maxSeq) s.maxSeq = event.seq;

  const isPartial = event.type === "transcript.partial";
  if (isPartial) {
    // Keep the latest partial for this turnId in-memory only (not in log).
    const p = event.payload as TranscriptPayload | null;
    const turnId = p?.turnId ?? event.id;
    s.partials.set(turnId, event);
  } else {
    // Clear any matching partial now that we have the final.
    if (event.type === "transcript.final") {
      const p = event.payload as TranscriptPayload | null;
      const turnId = p?.turnId ?? null;
      if (turnId) s.partials.delete(turnId);
    }
    // Insert into log in seq order (handle minor out-of-order bursts).
    const idx = s.log.findIndex((e) => e.seq > event.seq);
    if (idx === -1) s.log.push(event);
    else s.log.splice(idx, 0, event);
  }

  // Fan out to all current SSE subscribers (including partials — browsers handle the update).
  for (const sub of s.subscribers) {
    try { sub(event); } catch { /* subscriber closed */ }
  }
  return true;
}

/**
 * Subscribe to live events for one incident. Returns an unsubscribe function.
 * Immediately replays all log events with seq > afterSeq.
 */
export function subscribe(
  folder: string,
  eventId: string,
  afterSeq: number,
  subscriber: Subscriber,
): () => void {
  const s = getOrCreate(folder, eventId);
  s.subscribers.add(subscriber);

  // Replay missed finals.
  for (const e of s.log) {
    if (e.seq > afterSeq) {
      try { subscriber(e); } catch { /* ignore */ }
    }
  }

  return () => s.subscribers.delete(subscriber);
}

/** All final log entries for an incident (for state snapshot). */
export function getLog(folder: string, eventId: string): LiveEvent[] {
  return store.get(key(folder, eventId))?.log ?? [];
}

/** Highest seq seen (across partials and finals). */
export function getMaxSeq(folder: string, eventId: string): number {
  return store.get(key(folder, eventId))?.maxSeq ?? -1;
}

/** For tests: reset all state. */
export function _reset(): void {
  store.clear();
}
