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
    return { ...json, ok: res.ok && json.ok !== false, reason: typeof json.reason === "string" ? json.reason : res.ok ? undefined : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

/** Client helper for Discord dispatch (W2 button and the field page). */
export const notifyOps = (body: NotifyBody) => post("/api/notify", body);
