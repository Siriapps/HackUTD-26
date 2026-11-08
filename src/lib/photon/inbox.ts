// In-process store of Photon webhook events: dedupe by webhook-id (stable across retries) and a
// small ring buffer the reply handler and the debug GET read. Survives HMR via globalThis.
import type { PhotonEvent } from "./events";

const MAX = 200;

interface InboxState {
  seen: Set<string>;
  order: string[];
  events: PhotonEvent[];
  listeners: Set<(e: PhotonEvent) => void | Promise<void>>;
}

const g = globalThis as unknown as { __photonInbox?: InboxState };
const state: InboxState = (g.__photonInbox ??= { seen: new Set(), order: [], events: [], listeners: new Set() });

/** Returns false for a duplicate delivery (already accepted). */
export function accept(webhookId: string, event: PhotonEvent): boolean {
  if (state.seen.has(webhookId)) return false;
  state.seen.add(webhookId);
  state.order.push(webhookId);
  state.events.push(event);
  if (state.order.length > MAX) state.seen.delete(state.order.shift()!);
  if (state.events.length > MAX) state.events.shift();
  return true;
}

export function recent(n = 50): PhotonEvent[] {
  return state.events.slice(-n).reverse();
}

/** Subscribe to accepted events (the reply parser registers here). Returns an unsubscribe fn. */
export function onEvent(fn: (e: PhotonEvent) => void | Promise<void>): () => void {
  state.listeners.add(fn);
  return () => state.listeners.delete(fn);
}

export async function emit(e: PhotonEvent): Promise<void> {
  for (const fn of state.listeners) await fn(e);
}

export function _reset() {
  state.seen.clear();
  state.order.length = 0;
  state.events.length = 0;
  state.listeners.clear();
}
