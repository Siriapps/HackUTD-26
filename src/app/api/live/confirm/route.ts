/**
 * POST /api/live/confirm
 *
 * Ops-console action: confirm a runbook step or move the incident report along.
 * No field token required (same trust model as /api/dispatch/decide).
 *
 * Body: { folder, eventId, action: "step" | "ready" | "submit", stepIndex? }
 * Response: { ok, message }
 *
 * Goes through the same ingest path as the glasses so state, persistence and SSE stay consistent.
 */
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getLive } from "@/lib/live/hub";
import { ingest } from "@/lib/live/ingest";
import { loadLive } from "@/lib/db/incidents";
import type { LiveEvent } from "@/lib/live/types";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  if (typeof b.folder !== "string" || typeof b.eventId !== "string" || typeof b.action !== "string") {
    return NextResponse.json({ ok: false, error: "folder, eventId, action required" }, { status: 400 });
  }

  const { folder, eventId, action } = b as { folder: string; eventId: string; action: string };
  const live = getLive(folder, eventId) ?? (await loadLive(folder, eventId).catch(() => null));
  if (!live) {
    return NextResponse.json({ ok: false, error: "No active live session for this incident" }, { status: 404 });
  }

  const base = { id: randomUUID(), seq: live.maxSeq + 1, sessionId: live.sessionId, folder, eventId, at: Date.now() };
  let event: LiveEvent;
  let okMessage: string;

  if (action === "step") {
    const stepIndex = typeof b.stepIndex === "number" ? b.stepIndex : -1;
    event = {
      ...base,
      type: "runbook.update",
      payload: { stepIndex, status: "completed", technicianConfirmed: true, observation: "Confirmed by operator on the ops console." },
    };
    okMessage = `Step ${stepIndex + 1} marked completed by operator.`;
  } else if (action === "ready") {
    event = { ...base, type: "report.ready", payload: null };
    okMessage = "Report marked ready for review.";
  } else if (action === "submit") {
    event = { ...base, type: "report.submit", payload: { technician_confirmed: true } };
    okMessage = "Incident report submitted.";
  } else {
    return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
  }

  const outcome = await ingest(event);
  if (!outcome.accepted) {
    return NextResponse.json({ ok: false, error: outcome.result?.message ?? "rejected" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, message: okMessage });
}
