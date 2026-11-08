import type { Event } from "@/lib/data/types";

/**
 * Payload posted to P3's `POST /api/notify` (iMessage via Photon; Discord fallback). Kept flat:
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
    // The route says what actually happened ("Texted on-call tech (…0100) on iMessage.").
    const json = (await res.json().catch(() => ({}))) as { message?: string };
    if (!res.ok) return { ok: false, message: json.message ?? `Dispatch failed: ${res.status} ${res.statusText}` };
    return { ok: true, message: json.message ?? "Sent." };
  } catch (err) {
    return { ok: false, message: `Dispatch failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
