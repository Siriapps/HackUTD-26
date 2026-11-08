import { NextResponse } from "next/server";
import type { Event } from "@/lib/data/types";
import { decide } from "@/lib/dispatch/engine";
import { sendHandoff } from "@/lib/dispatch/handoff";
import { sendAlert, tellAlert } from "@/lib/dispatch/send";
import { serverEvent } from "@/lib/dispatch/server-data";
import { alertKey, getAlert, update, upsertAlert } from "@/lib/dispatch/store";
import { escalateNow, wireDispatch } from "@/lib/dispatch/wire";
import { photonConfig } from "@/lib/photon/client";
import { CATEGORY_COLOR, buildPayload, type NotifyKind } from "./payload";

/**
 * One dispatch endpoint for every screen:
 *  - ops dashboard (lib/export/notify): { type: "alert" | "handoff", folder, now, text, event? }
 *  - field page / Gemini tools (lib/dispatch): { event, folder, kind: alert|confirmation|observation|escalation|resolution, note? }
 * Photon (iMessage) is the channel; Discord is the fallback when Photon isn't configured.
 * Always answers { ok, message } so the button can show what actually happened.
 */
interface Body {
  type?: "alert" | "handoff";
  kind?: NotifyKind;
  event?: Event;
  folder?: string;
  now?: number;
  text?: string;
  note?: string;
}

const isEvent = (e: unknown): e is Event => {
  const x = e as Event | undefined;
  return !!x && typeof x.id === "string" && typeof x.facility === "string" && x.category in CATEGORY_COLOR;
};

export async function POST(req: Request) {
  wireDispatch();
  const body = ((await req.json().catch(() => null)) ?? {}) as Body;
  const origin = process.env.PUBLIC_BASE_URL || new URL(req.url).origin;
  const folder = body.folder ?? "";

  if (body.type === "handoff") {
    if (!photonConfig()) return discordOrExplain(null, body.text ?? "", origin, folder, "alert");
    const r = await sendHandoff({ consoleText: body.text, folder, asOf: body.now });
    if (!r.ok) return NextResponse.json({ ok: false, message: r.error }, { status: 404 });
    const message = r.sent.length
      ? `Texted the morning crew (${r.sent.join(", ")})${r.failed.length ? `; failed: ${r.failed.join(", ")}` : ""}.`
      : `Not sent: ${"reason" in r ? r.reason : `failed for ${r.failed.join(", ")}`}.`;
    return NextResponse.json({ ok: r.sent.length > 0, message, text: r.text }, { status: r.sent.length ? 200 : 503 });
  }

  const event = body.event;
  if (!isEvent(event)) return NextResponse.json({ ok: false, message: "body.event must be an Event" }, { status: 400 });
  const kind: NotifyKind = body.type === "alert" ? "alert" : (body.kind ?? "alert");

  if (!photonConfig()) return discordOrExplain(event, body.note, origin, folder, kind);

  if (kind === "alert") {
    const r = await sendAlert({ eventId: event.id, folder, asOf: body.now, baseUrl: origin });
    if (!r.ok) return NextResponse.json({ ok: false, message: r.error }, { status: r.status });
    if (!r.sent) return NextResponse.json({ ok: false, message: `Not sent: ${r.reason}.`, text: r.text }, { status: 503 });
    return NextResponse.json({ ok: true, message: `${r.repeat ? "Re-sent" : "Texted"} on-call tech (…${r.to.slice(-4)}) on iMessage.` });
  }

  // Field-app actions act on the dispatched alert; if none was sent, record one without a thread so the
  // decision still reaches the console and the morning handoff.
  const key = alertKey(folder, event.id);
  if (!getAlert(key)) {
    if (!(await serverEvent(folder, event.id).catch(() => null))) {
      return NextResponse.json({ ok: false, message: `${event.id} not found in ${folder || "the dataset"}` }, { status: 404 });
    }
    upsertAlert({ eventId: event.id, folder, spaceId: "field-app", handle: "field app", sentAt: Date.now() });
  }
  const deps = { getEvent: serverEvent };
  const by = "field app";

  if (kind === "observation") {
    const a = update(key, {}, { at: Date.now(), dir: "in", text: body.note ?? "", by })!;
    const n = await tellAlert(a, `👁 Field note on ${event.id}: ${body.note ?? ""}`, `obs:${key}:${Date.now()}`);
    return NextResponse.json({ ok: true, message: n ? `Shared with ${n} on the thread.` : "Logged." });
  }

  const command = kind === "confirmation" ? "approve" : kind === "resolution" ? "fixed" : "help";
  const r = await decide(key, command, by, deps);
  if (!r.ok) return NextResponse.json({ ok: false, message: r.text }, { status: 409 });
  const a = getAlert(key)!;
  if (kind === "resolution" && body.note && a.resolution) {
    update(key, { resolution: { ...a.resolution, notes: [...a.resolution.notes, body.note] } });
  }
  if (kind === "escalation" && body.note) update(key, {}, { at: Date.now(), dir: "in", text: body.note, intent: "help", by });
  const summary = r.text.split("\n")[0];
  const n = await tellAlert(getAlert(key)!, `📱 Field app on ${event.id}: ${summary}${body.note ? ` — "${body.note}"` : ""}`, `field:${key}:${kind}:${Date.now()}`);
  if (kind === "escalation") await escalateNow();
  return NextResponse.json({ ok: true, message: `${summary}${n ? ` (texted ${n})` : ""}` });
}

/** Photon not configured: legacy Discord embed, or explain why nothing was sent. */
async function discordOrExplain(event: Event | null, note: string | undefined, origin: string, folder: string, kind: NotifyKind) {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  const payload = event ? buildPayload({ ...event, evidence: (event.evidence ?? []).map(String), actions: event.actions ?? [] }, folder, origin, kind, note) : { content: note };
  if (!webhook) return NextResponse.json({ ok: false, message: "No channel configured (set PHOTON_API_KEY or DISCORD_WEBHOOK_URL).", payload }, { status: 503 });
  const res = await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }).catch(
    (e: Error) => new Response(e.message, { status: 599 }),
  );
  if (!res.ok) return NextResponse.json({ ok: false, message: `Discord replied ${res.status}` }, { status: 502 });
  return NextResponse.json({ ok: true, message: "Posted to Discord." });
}
