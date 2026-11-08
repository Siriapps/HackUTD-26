/**
 * Live Incident Response — shared types for the iOS ingest → Next.js hub → browser SSE pipeline.
 *
 * iOS publishes LiveEvent objects to POST /api/live/events.
 * The hub fans them out over GET /api/live/stream (SSE).
 * GET /api/live/state returns a LiveSnapshot for first paint / refresh.
 *
 * Media (audio/video) never passes through Next.js.
 */

// ─── Event envelope ──────────────────────────────────────────────────────────

export type LiveEventType =
  | "session.start"
  | "session.end"
  | "transcript.partial"
  | "transcript.final"
  | "runbook.update"
  | "note.append"
  | "report.draft"
  | "report.ready"
  | "report.submit";

export interface LiveEvent {
  /** UUID; idempotent — duplicates are ignored. */
  id: string;
  /** Monotonic per session. Out-of-order events are stored and emitted; the client sorts. */
  seq: number;
  sessionId: string;
  folder: string;
  eventId: string;
  /** Unix ms. */
  at: number;
  type: LiveEventType;
  payload: unknown;
}

// ─── Payload types ───────────────────────────────────────────────────────────

export interface SessionStartPayload {
  simulation: boolean;
  category: string;
}

export interface TranscriptPayload {
  role: "tech" | "gemini" | "system";
  text: string;
  /** Groups partial utterances. All partials for one turn share the same turnId. */
  turnId: string;
}

export type StepStatus = "pending" | "in_progress" | "completed" | "blocked";

export interface RunbookUpdatePayload {
  /** 0-based index into RUNBOOKS[category].steps. */
  stepIndex: number;
  status: StepStatus;
  observation?: string;
  /** `completed` requires this to be true. */
  technicianConfirmed: boolean;
  evidence?: string;
}

export interface NoteAppendPayload {
  kind: "observation" | "confirmation" | "blocked" | "system";
  text: string;
}

export interface ReportPayload {
  status: "draft" | "ready_for_review" | "submitted";
  summary: string;
  observations: string[];
  actions: string[];
  unresolved: string[];
  technicianConfirmed: boolean;
}

// ─── Runbook snapshot (persisted in incidents.live.runbook) ──────────────────

export interface RunbookStepState {
  index: number;
  text: string;
  status: StepStatus;
  observation?: string;
  technicianConfirmed: boolean;
  /** Unix ms when status last changed. */
  at?: number;
}

export interface RunbookState {
  category: string;
  rule: string;
  steps: RunbookStepState[];
}

// ─── Incident live snapshot (incidents.live jsonb) ───────────────────────────

export interface NoteEntry {
  at: number;
  kind: "observation" | "confirmation" | "blocked" | "system";
  text: string;
}

export interface IncidentLive {
  sessionId: string;
  startedAt: number;
  simulation: boolean;
  runbook: RunbookState;
  notes: NoteEntry[];
  report: ReportPayload | null;
  /** Highest seq seen so far. */
  maxSeq: number;
}

// ─── Browser-visible snapshot ─────────────────────────────────────────────────

export interface TranscriptLine {
  id: string;
  role: "tech" | "gemini" | "system";
  text: string;
  turnId: string;
  at: number;
  /** Still being appended to. Partials are not persisted. */
  open?: boolean;
}

export interface LiveSnapshot {
  sessionId: string | null;
  simulation: boolean;
  maxSeq: number;
  lines: TranscriptLine[];
  runbook: RunbookState | null;
  notes: NoteEntry[];
  report: ReportPayload | null;
}
