/**
 * Applies a published LiveEvent to an IncidentLive snapshot.
 * Called server-side in the ingest route after hub.publish().
 * Returns the updated snapshot (or null if no structural change needed).
 */

import { RUNBOOKS } from "@/lib/memory/incidents";
import type { Category } from "@/lib/data/types";
import type {
  IncidentLive,
  LiveEvent,
  NoteEntry,
  NoteAppendPayload,
  ReportPayload,
  RunbookUpdatePayload,
  SessionStartPayload,
} from "./types";
import { validateRunbookUpdate, validateDraftReport, validateReportSubmit } from "./validate";

/** Process a LiveEvent against the current IncidentLive snapshot.
 *  Returns [updatedLive, toolResponseResult] where toolResponseResult is
 *  the structured response to send back to iOS for Gemini tool calls. */
export function applyEvent(
  event: LiveEvent,
  live: IncidentLive | null,
): {
  live: IncidentLive;
  toolResult?: { ok: boolean; message: string; note?: string };
} {
  // Bootstrap a live session on session.start.
  if (event.type === "session.start" || !live) {
    const p = (event.type === "session.start" ? event.payload : null) as SessionStartPayload | null;
    const category = (p?.category ?? "pump_failure") as Category;
    const runbook = RUNBOOKS[category];
    const bootstrapped: IncidentLive = live ?? {
      sessionId: event.sessionId,
      startedAt: event.at,
      simulation: p?.simulation ?? false,
      runbook: {
        category,
        rule: runbook?.rule ?? "",
        steps: (runbook?.steps ?? []).map((text, index) => ({
          index,
          text,
          status: "pending",
          technicianConfirmed: false,
        })),
      },
      notes: [],
      report: null,
      maxSeq: event.seq,
    };
    if (event.type === "session.start") {
      return { live: { ...bootstrapped, sessionId: event.sessionId, startedAt: event.at, maxSeq: event.seq } };
    }
    live = bootstrapped;
  }

  const updated: IncidentLive = { ...live, maxSeq: Math.max(live.maxSeq, event.seq) };

  switch (event.type) {
    case "transcript.partial":
    case "transcript.final": {
      // Transcript lines are stored in the messages table, not in live jsonb.
      // No structural change to the live snapshot needed.
      break;
    }

    case "runbook.update": {
      const p = event.payload as RunbookUpdatePayload;
      const result = validateRunbookUpdate(p, updated);
      if (!result.ok) {
        return { live: updated, toolResult: { ok: false, message: result.error } };
      }
      const applied = result.value.applied;
      const steps = updated.runbook.steps.map((s) =>
        s.index === applied.stepIndex
          ? { ...s, status: applied.status, observation: applied.observation ?? s.observation, technicianConfirmed: applied.technicianConfirmed, at: event.at }
          : s,
      );
      updated.runbook = { ...updated.runbook, steps };
      // Append note if coerced.
      if (result.value.note) {
        updated.notes = [...updated.notes, { at: event.at, kind: "system", text: result.value.note }];
      }
      return { live: updated, toolResult: { ok: true, message: result.value.note ?? "step updated" } };
    }

    case "note.append": {
      const p = event.payload as NoteAppendPayload;
      const note: NoteEntry = { at: event.at, kind: p.kind, text: p.text };
      updated.notes = [...updated.notes, note];
      break;
    }

    case "report.draft": {
      const p = event.payload as Omit<ReportPayload, "status" | "technicianConfirmed">;
      const result = validateDraftReport(p);
      if (!result.ok) {
        return { live: updated, toolResult: { ok: false, message: result.error } };
      }
      updated.report = result.value;
      return { live: updated, toolResult: { ok: true, message: "incident report drafted" } };
    }

    case "report.ready": {
      if (!updated.report) {
        return { live: updated, toolResult: { ok: false, message: "no report drafted yet" } };
      }
      updated.report = { ...updated.report, status: "ready_for_review" };
      break;
    }

    case "report.submit": {
      const p = event.payload as { technician_confirmed?: boolean } | null;
      const result = validateReportSubmit(updated, p?.technician_confirmed === true);
      if (!result.ok) {
        return { live: updated, toolResult: { ok: false, message: result.error } };
      }
      updated.report = result.value;
      updated.notes = [...updated.notes, { at: event.at, kind: "confirmation", text: "Incident report submitted by technician." }];
      return { live: updated, toolResult: { ok: true, message: "report submitted" } };
    }

    case "session.end": {
      updated.notes = [...updated.notes, { at: event.at, kind: "system", text: "Session ended." }];
      break;
    }
  }

  return { live: updated };
}
