#!/usr/bin/env node
// Registers this app's webhook receiver with Photon and prints the signing secret once.
// Usage: npm run photon:webhook -- https://<public-host>/api/photon/webhook
// (public host = Vercel preview URL, or `npx localtunnel --port 3000` / ngrok for local dev)
import { readFileSync } from "node:fs";

const env = { ...process.env };
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !env[m[1]]) env[m[1]] = m[2];
  }
} catch {}

const url = process.argv[2];
const { PHOTON_API_KEY: key, PHOTON_PROJECT_ID: project } = env;
if (!url?.startsWith("https://")) {
  console.error("usage: npm run photon:webhook -- https://<host>/api/photon/webhook");
  process.exit(1);
}
if (!key || !project) {
  console.error("PHOTON_API_KEY and PHOTON_PROJECT_ID must be set in .env.local");
  process.exit(1);
}

const events = ["message.received", "message.delivered", "message.failed", "call.answered", "call.dtmf.received", "call.ended"];
const res = await fetch(`https://api.photon.codes/v1/projects/${project}/webhooks/destinations`, {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `whd:${url}` },
  body: JSON.stringify({ url, apiVersion: "2026-07-01", enabledEvents: events, name: "avon-night-shift" }),
});
const json = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`Photon ${res.status}:`, JSON.stringify(json));
  process.exit(1);
}
const data = json.data ?? json;
console.log(`destination ${data.destination?.destinationId} → ${url}`);
console.log(`\nAdd to .env.local (shown once):\nPHOTON_WEBHOOK_SECRET=${data.signingSecret}`);
