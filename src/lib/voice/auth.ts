import { createHmac, timingSafeEqual } from "node:crypto";

const eq = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** ElevenLabs → our tool / init webhooks carry a shared secret header we configured on the agent. */
export function toolAuthOk(req: Request, secret = process.env.VOICE_TOOL_SECRET) {
  if (!secret) return false;
  return eq(req.headers.get("x-avon-voice") ?? "", secret);
}

/**
 * ElevenLabs post-call webhook: header `ElevenLabs-Signature: t=<unix>,v0=<hex hmac-sha256(secret, "t.body")>`.
 * 30-minute tolerance, as in their SDK.
 */
export function verifyElevenLabs(sigHeader: string | null, rawBody: string, secret: string, nowSec = Math.floor(Date.now() / 1000)) {
  if (!sigHeader) return false;
  const parts = Object.fromEntries(sigHeader.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(nowSec - t) > 30 * 60 || !parts.v0) return false;
  const want = createHmac("sha256", secret).update(`${parts.t}.${rawBody}`).digest("hex");
  return eq(parts.v0, want);
}
