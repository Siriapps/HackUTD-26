// Connects Photon inbound texts to the dispatch engine and sends the reply back on the same line.
import { photonClient } from "@/lib/photon/client";
import { onEvent } from "@/lib/photon/inbox";
import { handleInbound } from "./engine";
import { serverEvent } from "./server-data";
import { update } from "./store";

const g = globalThis as unknown as { __dispatchWired?: boolean };

export function wireDispatch() {
  if (g.__dispatchWired) return;
  g.__dispatchWired = true;
  onEvent(async (e) => {
    if (e.kind !== "inbound_text") return;
    const result = await handleInbound({ spaceId: e.spaceId, text: e.text }, { getEvent: serverEvent });
    const client = photonClient();
    if (!client || !result.reply) return;
    await client.sendText(e.spaceId, result.reply, `reply:${e.messageId}`, await client.resolveSender(e.platform as never));
    for (const a of result.changed) update(a.key, {}, { at: Date.now(), dir: "out", text: result.reply });
  });
}
