/**
 * POST /api/live/confirm
 *
 * Ops-console action: confirm a runbook step or submit the incident report.
 * No field token required (same trust model as /api/dispatch/decide).
 *
 * Body: { folder, eventId, action: "step" | "ready" | "submit", stepIndex? }
 * Response: { ok, message }
 */
import { NextResponse } from "next/server";
import { publish } from "@/lib/live/hub";
import { applyEvent } from "@/lib/live/processor";
import { validateReportReady, validateRunbookUpdate } from "@/lib/live/validate";
import { saveLive, loadLive } from "@/lib/db/incidents";
import { randomUUID } from "crypto";
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
  const live = await loadLive(folder, eventId);
  if (!live) {
    return NextResponse.json({ ok: false, error: "No active live session for this incident" }, { status: 404 });
  }

  const now = Date.now();
  const sessionId = live.sessionId;

  if (action === "step") {
    const stepIndex = typeof b.stepIndex === "number" ? b.stepIndex : -1;
    const validation = validateRunbookUpdate(
      { stepIndex, status: "completed", technicianConfirmed: true },
      live,
    );
    if (!validation.ok) {
      return NextResponse.json({ ok: false, error: validation.error }, { status: 400 });
    }
    const event: LiveEvent = {
      id: randomUUID(),
      seq: live.maxSeq + 1,
      sessionId,
      folder,
      eventId,
      at: now,
      type: "runbook.update",
      payload: { stepIndex, status: "completed", technicianConfirmed: true, observation: "Confirmed by operator on the ops console." },
    };
    publish(event);
    const { live: updated } = applyEvent(event, live);
    saveLive(folder, eventId, updated);
    return NextResponse.json({ ok: true, message: `Step ${stepIndex} marked completed by operator.` });
  }

  if (action === "ready") {
    const result = validateReportReady(live);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    const event: LiveEvent = {
      id: randomUUID(),
      seq: live.maxSeq + 1,
      sessionId,
      folder,
      eventId,
      at: now,
      type: "report.ready",
      payload: null,
    };
    publish(event);
    const { live: updated } = applyEvent(event, live);
    saveLive(folder, eventId, updated);
    return NextResponse.json({ ok: true, message: "Report marked ready for review." });
  }

  if (action === "submit") {
    const event: LiveEvent = {
      id: randomUUID(),
      seq: live.maxSeq + 1,
      sessionId,
      folder,
      eventId,
      at: now,
      type: "report.submit",
      payload: { technician_confirmed: true },
    };
    publish(event);
    const { live: updated, toolResult } = applyEvent(event, live);
    if (toolResult && !toolResult.ok) {
      return NextResponse.json({ ok: false, error: toolResult.message }, { status: 400 });
    }
    saveLive(folder, eventId, updated);
    return NextResponse.json({ ok: true, message: "Incident report submitted." });
  }

  return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
}
