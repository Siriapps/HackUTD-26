/**
 * POST /api/live/events
 *
 * iOS glasses ingest endpoint. The iOS FlareLiveController sends LiveEvent JSON here
 * after each meaningful event (transcript final, runbook update, note, report, session lifecycle).
 *
 * Auth: `x-field-token` header (same as /api/gemini/glasses). Required outside dev.
 * Body: LiveEvent
 * Response: { ok, seq, result? }
 *
 * Idempotent: duplicate event.id → 200 no-op.
 * Does NOT receive audio or video — only text/structured events.
 */
import { NextResponse } from "next/server";
import { publish } from "@/lib/live/hub";
import { applyEvent } from "@/lib/live/processor";
import { validateEnvelope } from "@/lib/live/validate";
import { saveLive, loadLive, logMessage } from "@/lib/db/incidents";
import type { TranscriptPayload } from "@/lib/live/types";

function deviceAllowed(req: Request): boolean {
  const token = process.env.FIELD_DEVICE_TOKEN;
  return token
    ? req.headers.get("x-field-token") === token
    : process.env.NODE_ENV !== "production";
}

export async function POST(req: Request) {
  if (!deviceAllowed(req)) {
    return NextResponse.json({ ok: false, error: "forbidden: send x-field-token (FIELD_DEVICE_TOKEN)" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const envelope = validateEnvelope(body);
  if (!envelope.ok) {
    return NextResponse.json({ ok: false, error: envelope.error }, { status: 400 });
  }

  const ev = envelope.value;

  // Publish to hub (handles dedupe, subscriber fan-out, ordering).
  const isNew = publish({ ...ev, type: ev.type as import("@/lib/live/types").LiveEventType });
  if (!isNew) {
    // Duplicate — idempotent 200.
    return NextResponse.json({ ok: true, seq: ev.seq, duplicate: true });
  }

  // Apply event to persisted live snapshot (async, fire-and-forget for speed).
  void (async () => {
    try {
      const existing = await loadLive(ev.folder, ev.eventId);
      const { live: updated, toolResult } = applyEvent(
        { ...ev, type: ev.type as import("@/lib/live/types").LiveEventType },
        existing,
      );
      saveLive(ev.folder, ev.eventId, updated);

      // Persist final transcripts to messages table (channel='gemini').
      if (ev.type === "transcript.final") {
        const p = ev.payload as TranscriptPayload | null;
        logMessage({
          folder: ev.folder,
          eventId: ev.eventId,
          channel: "gemini",
          direction: p?.role === "tech" ? "in" : "out",
          body: p?.text ?? "",
          payload: { sessionId: ev.sessionId, seq: ev.seq, id: ev.id, role: p?.role, turnId: p?.turnId },
        });
      }

      if (toolResult && !toolResult.ok) {
        console.warn("[live/events] tool validation error:", toolResult.message);
      }
    } catch (err) {
      console.error("[live/events] persist error:", err instanceof Error ? err.message : err);
    }
  })();

  return NextResponse.json({ ok: true, seq: ev.seq });
}
