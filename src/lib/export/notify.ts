import type { Event } from "@/lib/data/types";

/**
 * Payload posted to W3's `POST /api/notify` (Discord webhook). Kept flat so W3 can map it to an embed:
 * `text` is ready to post as-is; `event` carries the structured alert when there is one.
 */
export interface NotifyPayload {
  type: "alert" | "handoff";
  folder: string;
  now: number;
  text: string;
  event?: Event;
  links: { facility?: string; field?: string; dashboard: string };
}

export async function dispatch(payload: NotifyPayload): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch("/api/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.status === 404) return { ok: false, message: "Dispatch route /api/notify is not wired yet (W3)." };
    if (!res.ok) return { ok: false, message: `Dispatch failed: ${res.status} ${res.statusText}` };
    return { ok: true, message: "Posted to Discord." };
  } catch (err) {
    return { ok: false, message: `Dispatch failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
