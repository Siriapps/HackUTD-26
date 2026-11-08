import type { Event } from "@/lib/data/types";

export type NotifyKind = "alert" | "confirmation" | "observation" | "escalation" | "resolution";

/** POST /api/notify body. The route itself is P3's; this client degrades if it is not up yet. */
export interface NotifyBody {
  event: Event;
  folder?: string;
  kind?: NotifyKind;
  note?: string;
}

export interface DispatchResult {
  ok: boolean;
  reason?: string;
}

async function post(url: string, body: unknown): Promise<DispatchResult & Record<string, unknown>> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    // /api/notify answers { ok, message }; `reason` carries that message for older callers.
    const msg = typeof json.message === "string" ? json.message : typeof json.reason === "string" ? json.reason : undefined;
    return { ...json, ok: res.ok && json.ok !== false, reason: msg ?? (res.ok ? undefined : `HTTP ${res.status}`) };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

/** Client helper for Discord dispatch (W2 button and the field page). */
export const notifyOps = (body: NotifyBody) => post("/api/notify", body);

/**
 * Pull resolutions captured over iMessage (FIXED + note/photo) into incident memory, once each.
 * Memory lives in this browser's localStorage, so any open console tab calls this on a poll.
 */
export async function syncResolutions(record: (eventId: string, text: string) => unknown): Promise<number> {
  const KEY = "avon.dispatch.synced.v1";
  let seen: Record<string, number> = {};
  try {
    seen = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? "{}");
  } catch {
    /* private mode */
  }
  const res = await fetch("/api/dispatch/state", { cache: "no-store" }).catch(() => null);
  if (!res?.ok) return 0;
  const alerts = (await res.json()) as {
    eventId: string;
    resolution?: { at: number; by: string; notes: string[]; photos: string[] };
    choice?: { label: string };
  }[];
  let n = 0;
  for (const a of alerts) {
    const r = a.resolution;
    if (!r) continue;
    const sig = r.notes.length * 1000 + r.photos.length + 1;
    if (seen[a.eventId] === sig) continue;
    const pics = r.photos.length ? ` (${r.photos.length} photo${r.photos.length === 1 ? "" : "s"} on the thread)` : "";
    const plan = a.choice ? ` Plan carried out: ${a.choice.label}.` : "";
    record(a.eventId, `Fixed by ${r.by}.${plan}${r.notes.length ? ` ${r.notes.join(" ")}` : ""}${pics}`.trim());
    seen[a.eventId] = sig;
    n++;
  }
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(seen));
  } catch {
    /* ignore */
  }
  return n;
}
