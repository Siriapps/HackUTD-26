import { NextResponse } from "next/server";
import { sendAlert } from "@/lib/dispatch/send";
import { wireDispatch } from "@/lib/dispatch/wire";
import { serverEvent } from "@/lib/dispatch/server-data";
import { upsertIncident } from "@/lib/db/incidents";

/**
 * POST { eventId, folder?, asOf?, to?, dryRun? } → texts the on-call tech the alert for one event.
 * dryRun (or no Photon config) returns the composed text without sending. Re-sending the same
 * event + plan is a no-op at Photon (idempotency key), so double-clicks never double-text.
 */
export async function POST(request: Request) {
  wireDispatch();
  const body = (await request.json().catch(() => ({}))) as { eventId?: string; folder?: string; asOf?: number; to?: string; dryRun?: boolean };
  if (!body.eventId) return NextResponse.json({ error: "eventId required" }, { status: 400 });
  const baseUrl = process.env.PUBLIC_BASE_URL || new URL(request.url).origin;
  const r = await sendAlert({ ...body, eventId: body.eventId, baseUrl });
  if (body.folder) {
    const found = await serverEvent(body.folder, body.eventId, body.asOf).catch(() => null);
    if (found) upsertIncident(body.folder, found.event);
  }
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error, code: r.code, text: r.text }, { status: r.status });
  return NextResponse.json(r);
}
