import { NextResponse } from "next/server";
import { composeAlert } from "@/lib/dispatch/alert";
import { loadRoster, onCallFor } from "@/lib/dispatch/roster";
import { serverEvent, serverFolders } from "@/lib/dispatch/server-data";
import { update, upsertAlert } from "@/lib/dispatch/store";
import { wireDispatch } from "@/lib/dispatch/wire";
import { PhotonError, photonClient } from "@/lib/photon/client";

/**
 * POST { eventId, folder?, to?, dryRun? } → texts the on-call tech the alert for one event.
 * dryRun (or no Photon config) returns the composed text without sending. Re-sending the same
 * event + plan is a no-op at Photon (idempotency key), so double-clicks never double-text.
 */
export async function POST(request: Request) {
  wireDispatch();
  const body = (await request.json().catch(() => ({}))) as { eventId?: string; folder?: string; to?: string; dryRun?: boolean };
  if (!body.eventId) return NextResponse.json({ error: "eventId required" }, { status: 400 });
  const folder = body.folder ?? (await serverFolders()).at(-1);
  if (!folder) return NextResponse.json({ error: "no dataset folders" }, { status: 404 });

  const found = await serverEvent(folder, body.eventId).catch(() => null);
  if (!found) return NextResponse.json({ error: `${body.eventId} not found in ${folder}` }, { status: 404 });
  const { event, now, fleet } = found;

  const baseUrl = process.env.PUBLIC_BASE_URL || new URL(request.url).origin;
  const text = composeAlert(event, { now, folder, baseUrl, fleet });

  const roster = await loadRoster();
  // Placeholder numbers from the example roster are never texted.
  const to = body.to ?? (roster.source === "example" ? undefined : onCallFor(roster, event.system)?.handle);
  const client = photonClient();
  if (body.dryRun || !client || !to) {
    return NextResponse.json({ ok: true, sent: false, reason: body.dryRun ? "dryRun" : !client ? "Photon not configured" : "no on-call handle (create config/ops-roster.json or set DISPATCH_ONCALL_HANDLE)", to, text });
  }

  const planSig = event.plan ? `${event.plan.recommended.label}|${Math.round(event.plan.recommended.cost)}` : "inspect";
  const key = `alert:${folder}:${event.id}:${planSig}`.slice(0, 255);
  try {
    const { space, sender } = await client.directSpace("imessage", to);
    const msg = await client.sendText(space.id, text, key, sender);
    const a = upsertAlert({ eventId: event.id, folder, spaceId: space.id, handle: to, sentAt: Date.now() });
    update(a.key, {}, { at: Date.now(), dir: "out", text });
    return NextResponse.json({ ok: true, sent: true, to, messageId: msg.id, text });
  } catch (err) {
    const e = err as PhotonError;
    return NextResponse.json({ ok: false, error: e.message, code: e.code, text }, { status: 502 });
  }
}
