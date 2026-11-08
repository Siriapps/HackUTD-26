import { NextResponse } from "next/server";
import { PhotonError, photonClient, type PhotonPlatform } from "@/lib/photon/client";

/**
 * POST { to: "+15551234567", text: "...", platform?: "imessage", key?: "alert-EV-0003-v1" }
 * Sends one message through Photon. Dev-only unless PHOTON_SEND_TOKEN is set and sent as `x-send-token`,
 * so a deployed URL can't be used to text arbitrary numbers.
 */
export async function POST(request: Request) {
  const token = process.env.PHOTON_SEND_TOKEN;
  const allowed = token ? request.headers.get("x-send-token") === token : process.env.NODE_ENV !== "production";
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const client = photonClient();
  if (!client) return NextResponse.json({ error: "Photon not configured" }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as {
    to?: string;
    text?: string;
    platform?: PhotonPlatform;
    key?: string;
  };
  if (!body.to || !body.text) return NextResponse.json({ error: "to and text are required" }, { status: 400 });

  try {
    const platform = body.platform ?? "imessage";
    const key = body.key ?? `manual:${platform}:${body.to}:${Date.now()}`;
    const msg = await client.textHandle(platform, body.to, body.text, key);
    return NextResponse.json({ ok: true, messageId: msg.id, key });
  } catch (err) {
    const e = err as PhotonError;
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.status >= 400 ? e.status : 502 });
  }
}
