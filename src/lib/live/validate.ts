/**
 * Server-side validation for structured Live events from the iOS glasses client.
 *
 * Rules (from the plan):
 * - stepIndex OOB → reject
 * - status "completed" requires technicianConfirmed === true (coerce to in_progress otherwise)
 * - status "blocked" requires observation
 * - submit_incident_report requires report.status === "ready_for_review" && technicianConfirmed
 * - Never auto-complete because Gemini recommended an action
 */

import type { IncidentLive, RunbookUpdatePayload, ReportPayload, StepStatus } from "./types";

export type ValidationResult<T> =
  | { ok: true; value: T; note?: string }
  | { ok: false; error: string };

/** Validate and apply a runbook step update to the live snapshot. Returns the corrected payload. */
export function validateRunbookUpdate(
  payload: RunbookUpdatePayload,
  live: IncidentLive,
): ValidationResult<{ applied: RunbookUpdatePayload; note?: string }> {
  const { stepIndex, status, observation, technicianConfirmed } = payload;
  const steps = live.runbook.steps;

  if (stepIndex < 0 || stepIndex >= steps.length) {
    return {
      ok: false,
      error: `stepIndex ${stepIndex} is out of range (runbook has ${steps.length} steps)`,
    };
  }

  if (status === "completed" && !technicianConfirmed) {
    // Coerce: Gemini cannot mark complete without explicit technician confirmation.
    const corrected: RunbookUpdatePayload = {
      ...payload,
      status: "in_progress" as StepStatus,
      technicianConfirmed: false,
    };
    return {
      ok: true,
      value: {
        applied: corrected,
        note: "Gemini proposed completion; awaiting technician confirmation.",
      },
    };
  }

  if (status === "blocked" && !observation) {
    return {
      ok: false,
      error: 'blocked status requires an observation explaining why',
    };
  }

  return { ok: true, value: { applied: payload } };
}

/** Validate a draft_incident_report payload. */
export function validateDraftReport(
  payload: Omit<ReportPayload, "status" | "technicianConfirmed">,
): ValidationResult<ReportPayload> {
  if (!payload.summary || payload.summary.trim().length === 0) {
    return { ok: false, error: "report summary is required" };
  }
  if (!Array.isArray(payload.observations)) {
    return { ok: false, error: "observations must be an array" };
  }
  if (!Array.isArray(payload.actions)) {
    return { ok: false, error: "actions must be an array" };
  }
  if (!Array.isArray(payload.unresolved)) {
    return { ok: false, error: "unresolved must be an array" };
  }
  return {
    ok: true,
    value: {
      status: "draft",
      summary: payload.summary.trim(),
      observations: payload.observations.map(String),
      actions: payload.actions.map(String),
      unresolved: payload.unresolved.map(String),
      technicianConfirmed: false,
    },
  };
}

/** Validate a submit_incident_report action. */
export function validateReportSubmit(
  live: IncidentLive,
  technicianConfirmed: boolean,
): ValidationResult<ReportPayload> {
  const report = live.report;
  if (!report) {
    return { ok: false, error: "no incident report drafted yet; call draft_incident_report first" };
  }
  if (report.status === "submitted") {
    return { ok: false, error: "report already submitted" };
  }
  if (!technicianConfirmed) {
    return {
      ok: false,
      error: "technician must confirm before submitting (set technician_confirmed true)",
    };
  }
  return {
    ok: true,
    value: { ...report, status: "submitted", technicianConfirmed: true },
  };
}

/** Mark a report ready for review (ops-side confirm, no technician required). */
export function validateReportReady(live: IncidentLive): ValidationResult<ReportPayload> {
  if (!live.report) {
    return { ok: false, error: "no report drafted yet" };
  }
  if (live.report.status === "submitted") {
    return { ok: false, error: "report already submitted" };
  }
  return { ok: true, value: { ...live.report, status: "ready_for_review" } };
}

/** Validate the whole LiveEvent envelope (basic structural checks). */
export function validateEnvelope(body: unknown): ValidationResult<{
  id: string;
  seq: number;
  sessionId: string;
  folder: string;
  eventId: string;
  at: number;
  type: string;
  payload: unknown;
}> {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.id !== "string" || !b.id.trim()) return { ok: false, error: "id (string) required" };
  if (typeof b.seq !== "number") return { ok: false, error: "seq (number) required" };
  if (typeof b.sessionId !== "string" || !b.sessionId.trim()) return { ok: false, error: "sessionId (string) required" };
  if (typeof b.folder !== "string") return { ok: false, error: "folder (string) required" };
  if (typeof b.eventId !== "string" || !b.eventId.trim()) return { ok: false, error: "eventId (string) required" };
  if (typeof b.at !== "number") return { ok: false, error: "at (number ms) required" };
  if (typeof b.type !== "string") return { ok: false, error: "type (string) required" };

  return {
    ok: true,
    value: {
      id: b.id.trim(),
      seq: b.seq,
      sessionId: b.sessionId.trim(),
      folder: b.folder,
      eventId: b.eventId.trim(),
      at: b.at,
      type: b.type,
      payload: b.payload ?? null,
    },
  };
}
