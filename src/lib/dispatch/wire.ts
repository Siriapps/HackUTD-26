// Connects Photon inbound texts to the dispatch engine, cross-posts decisions to everyone on the alert,
// and runs the escalation ticker. Re-wires cleanly on HMR (old listener/timer torn down).
import { photonClient, type PhotonClient } from "@/lib/photon/client";
import { onEvent } from "@/lib/photon/inbox";
import { handleInbound } from "./engine";
import { sendHandoff } from "./handoff";
import { loadRoster } from "./roster";
import { serverEvent } from "./server-data";
import { getAlert, otherSpaces, update } from "./store";
import { crossPost, tick } from "./ticker";

const TICK_MS = 15_000;

const g = globalThis as unknown as {
  __dispatchWire?: { unsub: () => void; timer: ReturnType<typeof setInterval> };
  __handoffDay?: string;
};
/** Only real Photon threads get texts (field-app-only alerts have no thread). */
const isThread = (spaceId: string) => spaceId.startsWith("pho_spc_");
let wiredHere = false;

const timeScale = () => Math.max(1, Number(process.env.DISPATCH_TIME_SCALE) || 1);

async function runTick(client: PhotonClient) {
  const sender = await client.resolveSender("imessage");
  return tick({
    getEvent: serverEvent,
    roster: loadRoster,
    openSpace: async (handle) => (await client.directSpace("imessage", handle)).space.id,
    send: async (spaceId, text, key) => void (await client.sendText(spaceId, text, key, sender)),
    call: (handle) => import("@/lib/voice/call").then((m) => m.callHandle(handle)),
    nowMs: Date.now(),
    timeScale: timeScale(),
  });
}

/** Page the supervisor now (HELP from a text or the field app) instead of waiting for the next tick. */
export async function escalateNow() {
  const client = photonClient();
  if (client) await runTick(client).catch((err) => console.error("[dispatch] escalation", err));
}

/**
 * DISPATCH_HANDOFF_AT="06:00" (server local time; set TZ) texts the morning crew once a day.
 * Exported for tests; the ticker calls it.
 */
export async function maybeScheduledHandoff(now = new Date()) {
  const at = process.env.DISPATCH_HANDOFF_AT?.trim();
  if (!at || !/^\d{1,2}:\d{2}$/.test(at)) return null;
  const [h, m] = at.split(":").map(Number);
  const day = now.toLocaleDateString("en-CA");
  if (g.__handoffDay === day || now.getHours() * 60 + now.getMinutes() < h * 60 + m) return null;
  g.__handoffDay = day;
  return sendHandoff({}).catch((err) => console.error("[dispatch] handoff", err));
}

export function wireDispatch() {
  if (wiredHere) return;
  wiredHere = true;
  if (g.__dispatchWire) {
    g.__dispatchWire.unsub();
    clearInterval(g.__dispatchWire.timer);
  }

  const unsub = onEvent(async (e) => {
    if (e.kind !== "inbound_text") return;
    const client = photonClient();
    const sender = client ? await client.resolveSender(e.platform as never) : null;
    // Typing bubble first (not awaited) so the tech sees we're on it while analysis runs.
    if (client && sender) void client.typing(e.spaceId, sender);
    const result = await handleInbound({ spaceId: e.spaceId, text: e.text, attachments: e.attachments }, { getEvent: serverEvent });
    if (!client || !sender || !result.reply) return;
    await client.sendText(e.spaceId, result.reply, `reply:${e.messageId}`, sender);

    for (const changed of result.changed) {
      const a = getAlert(changed.key) ?? changed;
      update(a.key, {}, { at: Date.now(), dir: "out", text: result.reply });
      // Everyone else on the alert (tech ↔ supervisor) sees who decided what.
      const who = a.spaceId === e.spaceId ? "On-call tech" : ((a.watchers ?? []).find((w) => w.spaceId === e.spaceId)?.name ?? "Supervisor");
      for (const other of otherSpaces(a, e.spaceId).filter(isThread)) {
        await client.sendText(other, crossPost(a, who, result.reply), `xpost:${e.messageId}:${other}`, sender).catch(() => undefined);
      }
    }
    // HELP pages the supervisor now rather than on the next tick.
    if (result.changed.some((c) => c.status === "escalated")) await escalateNow();
  });

  const timer = setInterval(() => {
    const client = photonClient();
    if (client) runTick(client).catch((err) => console.error("[dispatch] tick", err));
    void maybeScheduledHandoff();
  }, TICK_MS);
  timer.unref?.();
  g.__dispatchWire = { unsub, timer };
}
