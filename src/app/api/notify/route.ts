import { NextResponse } from "next/server";
import type { Event } from "@/lib/data/types";
import { CATEGORY_COLOR, buildPayload, type NotifyBody } from "./payload";

/** Post an alert / confirmation / escalation to the Discord webhook. Without a webhook it returns the payload it would have sent (503). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Partial<NotifyBody> | null;
  const event = body?.event;
  if (!event || typeof event.id !== "string" || typeof event.facility !== "string" || !(event.category in CATEGORY_COLOR)) {
    return NextResponse.json({ ok: false, reason: "body.event must be an Event" }, { status: 400 });
  }
  const safeEvent: Event = {
    ...event,
    evidence: Array.isArray(event.evidence) ? event.evidence.map(String) : [],
    actions: Array.isArray(event.actions) ? event.actions : [],
  };
  const origin = process.env.PUBLIC_BASE_URL || new URL(req.url).origin;
  const payload = buildPayload(safeEvent, body?.folder ?? "", origin, body?.kind ?? "alert", body?.note);
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return NextResponse.json({ ok: false, reason: "DISCORD_WEBHOOK_URL is not set on the server", payload }, { status: 503 });
  const res = await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }).catch(
    (e: Error) => new Response(e.message, { status: 599 }),
  );
  if (!res.ok) return NextResponse.json({ ok: false, reason: `Discord replied ${res.status}` }, { status: 502 });
  return NextResponse.json({ ok: true });
}
