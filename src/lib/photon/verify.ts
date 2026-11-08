// Standard Webhooks verification as used by Photon beta deliveries:
// HMAC-SHA256(base64decode(secret without "whsec_"), `${webhook-id}.${webhook-timestamp}.${rawBody}`),
// header `webhook-signature` = space-separated "v1,<base64>" entries. 5-minute timestamp tolerance.
import { createHmac, timingSafeEqual } from "node:crypto";

export const TOLERANCE_SEC = 5 * 60;

export interface WebhookHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export type VerifyResult = { ok: true; id: string } | { ok: false; reason: string };

export function sign(secret: string, id: string, timestamp: string, rawBody: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest("base64");
}

export function verifyWebhook(
  secret: string,
  h: WebhookHeaders,
  rawBody: string,
  nowSec = Math.floor(Date.now() / 1000),
): VerifyResult {
  if (!h.id || !h.timestamp || !h.signature) return { ok: false, reason: "missing webhook headers" };
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "bad timestamp" };
  if (Math.abs(nowSec - ts) > TOLERANCE_SEC) return { ok: false, reason: "timestamp outside tolerance" };
  const expected = Buffer.from(sign(secret, h.id, h.timestamp, rawBody));
  for (const part of h.signature.split(" ")) {
    const [version, sig] = part.split(",", 2);
    if (version !== "v1" || !sig) continue;
    const got = Buffer.from(sig);
    if (got.length === expected.length && timingSafeEqual(got, expected)) return { ok: true, id: h.id };
  }
  return { ok: false, reason: "signature mismatch" };
}
