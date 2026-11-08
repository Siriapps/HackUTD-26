import { NextResponse, after } from "next/server";
import { parseEvent } from "@/lib/photon/events";
import { accept, emit, recent } from "@/lib/photon/inbox";
import { verifyWebhook } from "@/lib/photon/verify";
import { wireDispatch } from "@/lib/dispatch/wire";

wireDispatch();

/** Photon webhook receiver. 400 on bad signature (no retry), 2xx on duplicates, 503 if unconfigured (retry). */
export async function POST(request: Request) {
  const secret = process.env.PHOTON_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "PHOTON_WEBHOOK_SECRET not set" }, { status: 503 });

  const raw = await request.text();
  const v = verifyWebhook(
    secret,
    {
      id: request.headers.get("webhook-id"),
      timestamp: request.headers.get("webhook-timestamp"),
      signature: request.headers.get("webhook-signature"),
    },
    raw,
  );
  if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 400 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const event = parseEvent(body);
  if (!accept(v.id, event)) return NextResponse.json({ ok: true, duplicate: true });

  // Ack Photon immediately; act after the response so slow handlers never trigger a redelivery.
  after(async () => {
    try {
      await emit(event);
    } catch (err) {
      console.error("[photon] handler failed", err);
    }
  });
  return NextResponse.json({ ok: true, kind: event.kind });
}

/** Debug view of the last events (no message bodies leave the server beyond this dev aid). */
export async function GET() {
  if (process.env.NODE_ENV === "production" && !process.env.PHOTON_DEBUG) {
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  }
  return NextResponse.json(recent());
}
