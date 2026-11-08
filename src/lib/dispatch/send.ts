// Server-side senders shared by /api/dispatch/*, /api/notify and the scheduled handoff.
import { createHash } from "node:crypto";
import { PhotonError, photonClient } from "@/lib/photon/client";
import { composeAlert } from "./alert";
import { loadRoster, onCallFor, type Person } from "./roster";
import { serverEvent, serverFolders } from "./server-data";
import { getAlert, otherSpaces, update, upsertAlert, alertKey, type OpenAlert } from "./store";

export interface SendAlertInput {
  eventId: string;
  folder?: string;
  /** Operator's time-travel now (dataset unix s). */
  asOf?: number;
  /** Wall-clock ms of this replay firing. A new pass must send again; omit for a manual text, which stays idempotent. */
  replayId?: number;
  to?: string;
  dryRun?: boolean;
  baseUrl: string;
}

export type SendResult =
  | { ok: true; sent: true; to: string; messageId: string; text: string; repeat: boolean }
  | { ok: true; sent: false; reason: string; to?: string; text: string }
  | { ok: false; status: number; error: string; code?: string; text?: string };

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

export async function sendAlert(input: SendAlertInput): Promise<SendResult> {
  const folder = input.folder || (await serverFolders()).at(-1);
  if (!folder) return { ok: false, status: 404, error: "no dataset folders" };
  const found = await serverEvent(folder, input.eventId, input.asOf).catch(() => null);
  if (!found) return { ok: false, status: 404, error: `${input.eventId} not found in ${folder}` };
  const { event, now, fleet } = found;
  const text = composeAlert(event, { now, folder, baseUrl: input.baseUrl, fleet, voiceNumber: process.env.PHOTON_VOICE_NUMBER?.trim() || undefined });

  const roster = await loadRoster();
  // Placeholder numbers from the example roster are never texted.
  const rostered = roster.source === "example" ? undefined : onCallFor(roster, event.system)?.handle;
  const to = [input.to, rostered].find((h) => h && !isPlaceholder(h));
  const client = photonClient();
  if (input.dryRun || !client || !to) {
    const reason = input.dryRun ? "dryRun" : !client ? "Photon not configured" : "no on-call handle (create config/ops-roster.json or set DISPATCH_ONCALL_HANDLE)";
    // Still open the thread: the On-call board shows the alert, ops can decide from the console,
    // and the log says plainly that no text went out.
    const a = upsertAlert({ eventId: event.id, folder, asOf: input.asOf, spaceId: "local", handle: to ?? "unsent", sentAt: Date.now() });
    if (!a.log.some((l) => l.text === text)) update(a.key, {}, { at: Date.now(), dir: "out", text: `${text}

(not sent: ${reason})`, by: "ops" });
    return { ok: true, sent: false, reason, to, text };
  }

  // Manual text: same event + plan + asOf → same key, so a double-click does not double-text.
  // Replay passes replayId. Photon 422s when a key is reused with a different body, and a
  // matching key does not deliver a second message, so each forward pass needs its own key.
  const planSig = event.plan ? `${event.plan.recommended.label}|${Math.round(event.plan.recommended.cost)}` : "inspect";
  const key = `alert:${folder}:${event.id}:${hash(`${planSig}|${input.asOf ?? ""}|${input.replayId ?? ""}`)}`;
  const repeat = !!getAlert(alertKey(folder, event.id));
  try {
    const { space, sender } = await client.directSpace("imessage", to);
    const msg = await client.sendText(space.id, text, key, sender);
    const a = upsertAlert({ eventId: event.id, folder, asOf: input.asOf, spaceId: space.id, handle: to, sentAt: Date.now() });
    update(a.key, {}, { at: Date.now(), dir: "out", text, by: "ops" });
    return { ok: true, sent: true, to, messageId: msg.id, text, repeat };
  } catch (err) {
    const e = err as PhotonError;
    const a = upsertAlert({ eventId: event.id, folder, asOf: input.asOf, spaceId: "local", handle: to, sentAt: Date.now() });
    if (!a.log.some((l) => l.text === text || l.text.startsWith(text))) {
      update(a.key, {}, { at: Date.now(), dir: "out", text: `${text}\n\n(not sent: ${e.message})`, by: "ops" });
    }
    return { ok: false, status: 502, error: e.message, code: e.code, text };
  }
}

/** Text everyone following an alert (tech + paged supervisors), except `exceptSpace`. Best effort. */
export async function tellAlert(a: OpenAlert, text: string, key: string, exceptSpace?: string) {
  const client = photonClient();
  if (!client) return 0;
  const sender = await client.resolveSender("imessage");
  const spaces = (exceptSpace ? otherSpaces(a, exceptSpace) : [a.spaceId, ...otherSpaces(a, a.spaceId)]).filter((s) => s.startsWith("pho_spc_"));
  let n = 0;
  for (const s of spaces) {
    await client.sendText(s, text, `${key}:${s}`, sender).then(() => n++, () => undefined);
  }
  return n;
}

/** Fictional numbers (555-01xx) and example domains are never contacted, whatever the roster says. */
export const isPlaceholder = (handle: string) => /^\+?1?555555\d{4}$/.test(handle.replace(/[^\d+]/g, "")) || /@example\.(com|org|net)$/i.test(handle);

/** Text a list of people (morning crew handoff). Returns who got it and who didn't. */
export async function textPeople(people: Person[], text: string, key: string) {
  const client = photonClient();
  const sent: string[] = [];
  const failed: string[] = [];
  if (!client) return { sent, failed: people.map((p) => p.name), reason: "Photon not configured" };
  for (const p of people) {
    if (isPlaceholder(p.handle)) {
      failed.push(`${p.name} (placeholder)`);
      continue;
    }
    try {
      await client.textHandle(p.channel === "email" ? "email" : "imessage", p.handle, text, `${key}:${hash(p.handle)}`);
      sent.push(p.name);
    } catch {
      failed.push(p.name);
    }
  }
  return { sent, failed };
}
