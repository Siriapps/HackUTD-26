/**
 * GET /api/live/stream?folder=&eventId=&afterSeq=
 *
 * Server-Sent Events endpoint. Delivers LiveEvent JSON to the browser incident page.
 * - Uses `connection()` to prevent prerendering.
 * - Replays all stored finals with seq > afterSeq immediately on connect.
 * - Sends a heartbeat comment every 15s to keep the connection alive through proxies.
 * - On close/error the client's EventSource reconnects and resumes with the last seen seq.
 */
import { connection } from "next/server";
import { subscribe } from "@/lib/live/hub";
import type { LiveEvent } from "@/lib/live/types";

const HEARTBEAT_MS = 15_000;

export async function GET(req: Request) {
  await connection();

  const url = new URL(req.url);
  const folder = url.searchParams.get("folder") ?? "";
  const eventId = url.searchParams.get("eventId") ?? "";
  const afterSeq = parseInt(url.searchParams.get("afterSeq") ?? "-1", 10);

  if (!eventId.trim()) {
    return new Response("eventId required", { status: 400 });
  }

  let controller: ReadableStreamDefaultController<Uint8Array>;
  const enc = new TextEncoder();

  function send(event: LiveEvent) {
    try {
      controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`));
    } catch {
      // Stream closed — subscriber will be removed by the cleanup.
    }
  }

  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unsub: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl;

      // Subscribe and immediately replay afterSeq.
      unsub = subscribe(folder, eventId, afterSeq, send);

      // Heartbeat.
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(enc.encode(": heartbeat\n\n"));
        } catch {
          if (heartbeat) clearInterval(heartbeat);
        }
      }, HEARTBEAT_MS);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      unsub?.();
    },
  });

  // Abort when the client disconnects.
  req.signal.addEventListener("abort", () => {
    if (heartbeat) clearInterval(heartbeat);
    unsub?.();
    try { controller.close(); } catch { /* already closed */ }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
