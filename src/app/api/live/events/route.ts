/**
 * POST /api/live/events
 *
 * iOS glasses ingest endpoint. The iOS FlareLiveController sends LiveEvent JSON here
 * after each meaningful event (transcript final, runbook update, note, report, session lifecycle).
 *
 * Auth: `x-field-token` header (same as /api/gemini/glasses). Required outside dev.
 * Body: LiveEvent
 * Response: { ok, seq, accepted, result? }  — `result` is the server's verdict on tool-driven events
 *   (runbook.update / report.*) so the phone can tell Gemini what actually happened.
 *
 * Idempotent: duplicate event.id → 200 no-op.
 * Does NOT receive audio or video — only text/structured events.
 */
import { NextResponse } from "next/server";
import { ingest } from "@/lib/live/ingest";
import { validateEnvelope } from "@/lib/live/validate";
import { logMessage } from "@/lib/db/incidents";
import { appendLiveLine } from "@/lib/dispatch/store";
import type { LiveEvent, TranscriptPayload } from "@/lib/live/types";

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

  const ev = envelope.value as LiveEvent;

  let outcome;
  try {
    outcome = await ingest(ev);
  } catch (err) {
    console.error("[live/events] ingest error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "ingest failed" }, { status: 500 });
  }
  if (outcome.duplicate) return NextResponse.json({ ok: true, seq: ev.seq, duplicate: true });

  if (!outcome.accepted) {
    console.warn(`[live/events] ${ev.type} rejected:`, outcome.result?.message);
  }

  // Final transcripts: Event Thread log (board) + messages table (restart-proof transcript).
  if (outcome.accepted && ev.type === "transcript.final") {
    const p = ev.payload as TranscriptPayload | null;
    if (p?.text?.trim()) {
      try {
        appendLiveLine(ev.folder, ev.eventId, {
          id: ev.id,
          at: ev.at,
          dir: p.role === "tech" ? "in" : "out",
          text: p.text,
          by: p.role === "tech" ? "tech (glasses)" : "gemini",
        });
      } catch (err) {
        console.error("[live/events] thread append error:", err instanceof Error ? err.message : err);
      }
      logMessage({
        folder: ev.folder,
        eventId: ev.eventId,
        channel: "gemini",
        direction: p.role === "tech" ? "in" : "out",
        body: p.text,
        payload: { sessionId: ev.sessionId, seq: ev.seq, id: ev.id, role: p.role, turnId: p.turnId },
      });
    }
  }

  // Escalations reach the board too (ad-hoc events cannot go through /api/notify).
  if (outcome.accepted && ev.type === "note.append") {
    const p = ev.payload as { kind?: string; text?: string } | null;
    if (p?.kind === "escalation" && p.text?.trim()) {
      try {
        appendLiveLine(ev.folder, ev.eventId, { id: ev.id, at: ev.at, dir: "in", text: `ESCALATION: ${p.text}`, by: "glasses", intent: "help" });
      } catch (err) {
        console.error("[live/events] escalation append error:", err instanceof Error ? err.message : err);
      }
    }
  }

  return NextResponse.json({ ok: true, seq: ev.seq, accepted: outcome.accepted, result: outcome.result });
}
