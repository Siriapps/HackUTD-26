/**
 * Applies a published LiveEvent to an IncidentLive snapshot (pure; no I/O).
 * Called server-side by ingest.ts, which owns persistence and SSE fan-out.
 *
 * Besides the new snapshot it returns what browsers should see on the wire:
 * - `publishPayload`: the payload after server-side coercion (e.g. an unconfirmed `completed` is shown as
 *   `in_progress`, a session.start carries the seeded runbook, a report.draft carries the filled-in arrays).
 * - `derivedNotes`: notes the server created from the event (blocked reasons, confirmations, observations).
 * - `accepted`: false when validation rejected the event; rejected events are neither stored nor broadcast.
 */

import { RUNBOOKS, type Runbook } from "@/lib/memory/incidents";
import type { Category } from "@/lib/data/types";
import type {
  IncidentLive,
  LiveEvent,
  NoteEntry,
  NoteKind,
  NoteAppendPayload,
  ReportPayload,
  RunbookState,
  RunbookUpdatePayload,
  SessionStartPayload,
  StepStatus,
} from "./types";
import { validateRunbookUpdate, validateDraftReport, validateReportSubmit } from "./validate";

export interface ApplyResult {
  live: IncidentLive;
  accepted: boolean;
  toolResult?: { ok: boolean; message: string; note?: string };
  publishPayload?: unknown;
  derivedNotes: NoteEntry[];
}

const NOTE_KINDS: NoteKind[] = ["observation", "confirmation", "blocked", "system", "escalation"];
const STEP_STATUSES: StepStatus[] = ["pending", "in_progress", "completed", "blocked"];

/**
 * Runbook for events with no telemetry on record (a technician typed a new event id on the phone), and the safe
 * fallback when the category cannot be resolved. Deterministic like the others: same steps, same order, every time.
 */
export const GENERAL_RUNBOOK: Runbook = {
  steps: [
    "Make the area safe: lockout/tagout and a gas check before touching anything",
    "Identify the asset and describe the symptom: what, where, since when",
    "Record gauge readings and photograph what you see",
    "Isolate the affected equipment if it is safe to do so",
    "Tell operations what you found and what you need",
    "Decide: repair now, monitor, or escalate",
    "Confirm the area is safe and the equipment state is on record",
  ],
  rule: "No telemetry is on record for this event: use only what the technician reports.",
};

export const GENERAL = "general";
type RunbookCategory = Category | typeof GENERAL;

const runbookFor = (c: RunbookCategory): Runbook => (c === GENERAL ? GENERAL_RUNBOOK : RUNBOOKS[c]);
const isCategory = (c: unknown): c is RunbookCategory =>
  c === GENERAL || (typeof c === "string" && Object.prototype.hasOwnProperty.call(RUNBOOKS, c));

/**
 * Category for the runbook. Order: the server's own lookup of the event (hint) → a string `category` from the
 * client → `category.category` when a client sent the whole event object → "general" (the pane is never empty).
 */
export function pickCategory(payloadCategory: unknown, hint?: string): RunbookCategory {
  if (isCategory(hint)) return hint;
  if (isCategory(payloadCategory)) return payloadCategory;
  const nested = (payloadCategory as { category?: unknown } | null)?.category;
  if (isCategory(nested)) return nested;
  return GENERAL;
}

export function seedRunbook(category: RunbookCategory): RunbookState {
  const rb = runbookFor(category);
  return {
    category,
    rule: rb.rule,
    steps: rb.steps.map((text, index) => ({ index, text, status: "pending", technicianConfirmed: false })),
  };
}

function newLive(event: LiveEvent, category: RunbookCategory, simulation: boolean): IncidentLive {
  return {
    sessionId: event.sessionId,
    startedAt: event.at,
    simulation,
    runbook: seedRunbook(category),
    notes: [],
    report: null,
    maxSeq: event.seq,
  };
}

/** Accepts an array, a JSON-array string or a newline-separated string; undefined when the field is absent. */
function toList(v: unknown): string[] | undefined {
  if (v == null) return undefined;
  let arr: unknown[] | undefined;
  if (Array.isArray(v)) arr = v;
  else if (typeof v === "string") {
    const t = v.trim();
    if (!t) return [];
    if (t.startsWith("[")) {
      try {
        const parsed = JSON.parse(t);
        if (Array.isArray(parsed)) arr = parsed;
      } catch {
        /* fall through to newline split */
      }
    }
    arr ??= t.split("\n");
  }
  return arr?.map((x) => String(x).trim().replace(/^[-•]\s*/, "")).filter(Boolean);
}

const stepLabel = (rb: RunbookState, i: number) => `Step ${i + 1}${rb.steps[i] ? ` (${rb.steps[i].text})` : ""}`;

export function applyEvent(event: LiveEvent, live: IncidentLive | null, categoryHint?: string): ApplyResult {
  const derivedNotes: NoteEntry[] = [];

  // Bootstrap: session.start always (re)seeds for a new session; any other event seeds if nothing exists yet
  // or the stored runbook is empty (state written before the runbook fix).
  if (event.type === "session.start") {
    const p = (event.payload ?? {}) as Partial<SessionStartPayload>;
    const category = pickCategory(p.category, categoryHint);
    const simulation = p.simulation === true;
    const next: IncidentLive =
      live && live.sessionId === event.sessionId && live.runbook.steps.length > 0
        ? { ...live, simulation, maxSeq: Math.max(live.maxSeq, event.seq) }
        : newLive(event, category, simulation);
    return {
      live: next,
      accepted: true,
      publishPayload: { simulation, category: next.runbook.category, runbook: next.runbook },
      derivedNotes,
    };
  }

  if (!live || live.runbook.steps.length === 0) {
    const category = pickCategory(undefined, categoryHint);
    const seeded = newLive(event, category, live?.simulation ?? false);
    live = live ? { ...live, runbook: seeded.runbook } : seeded;
  }

  const updated: IncidentLive = { ...live, notes: [...live.notes], maxSeq: Math.max(live.maxSeq, event.seq) };
  const note = (kind: NoteKind, text: string) => {
    const n: NoteEntry = { at: event.at, kind, text };
    updated.notes.push(n);
    derivedNotes.push(n);
  };
  const reject = (message: string): ApplyResult => ({
    live,
    accepted: false,
    toolResult: { ok: false, message },
    derivedNotes: [],
  });

  switch (event.type) {
    case "runbook.update": {
      const raw = (event.payload ?? {}) as Record<string, unknown>;
      const p: RunbookUpdatePayload = {
        stepIndex: Number(raw.stepIndex),
        status: STEP_STATUSES.includes(raw.status as StepStatus) ? (raw.status as StepStatus) : "in_progress",
        observation: typeof raw.observation === "string" && raw.observation.trim() ? raw.observation.trim() : undefined,
        technicianConfirmed: raw.technicianConfirmed === true || raw.technicianConfirmed === "true",
      };
      if (!Number.isInteger(p.stepIndex)) return reject("stepIndex must be an integer (0-based)");
      const result = validateRunbookUpdate(p, updated);
      if (!result.ok) return reject(result.error);
      const applied = result.value.applied;
      updated.runbook = {
        ...updated.runbook,
        steps: updated.runbook.steps.map((s) =>
          s.index === applied.stepIndex
            ? { ...s, status: applied.status, observation: applied.observation ?? s.observation, technicianConfirmed: applied.technicianConfirmed, at: event.at }
            : s,
        ),
      };
      const label = stepLabel(updated.runbook, applied.stepIndex);
      if (applied.status === "blocked") note("blocked", `${label} blocked: ${applied.observation}`);
      else if (applied.status === "completed") note("confirmation", `${label} confirmed complete by the technician.${applied.observation ? ` ${applied.observation}` : ""}`);
      else if (applied.observation) note("observation", `${label}: ${applied.observation}`);
      if (result.value.note) note("system", `${label}: ${result.value.note}`);
      return {
        live: updated,
        accepted: true,
        toolResult: { ok: true, message: result.value.note ?? `step ${applied.stepIndex} is now ${applied.status}` },
        publishPayload: applied,
        derivedNotes,
      };
    }

    case "note.append": {
      const raw = (event.payload ?? {}) as Partial<NoteAppendPayload>;
      const text = typeof raw.text === "string" ? raw.text.trim() : "";
      if (!text) return reject("note text is required");
      const kind = NOTE_KINDS.includes(raw.kind as NoteKind) ? (raw.kind as NoteKind) : "observation";
      updated.notes.push({ at: event.at, kind, text });
      // The note itself is the event; nothing derived.
      derivedNotes.length = 0;
      return { live: updated, accepted: true, toolResult: { ok: true, message: "noted" }, publishPayload: { kind, text }, derivedNotes };
    }

    case "report.draft": {
      if (updated.report?.status === "submitted") return reject("report already submitted");
      const raw = (event.payload ?? {}) as Record<string, unknown>;
      const steps = updated.runbook.steps;
      const doneSteps = steps.filter((s) => s.status === "completed");
      const openSteps = steps.filter((s) => s.status !== "completed");
      const observations = toList(raw.observations) ?? updated.notes.filter((n) => n.kind === "observation" || n.kind === "blocked").map((n) => n.text);
      const actions = toList(raw.actions) ?? doneSteps.map((s) => `Completed: ${s.text}`);
      const unresolved = toList(raw.unresolved) ?? openSteps.map((s) => `${s.status === "blocked" ? "Blocked" : "Not completed"}: ${s.text}${s.observation ? ` (${s.observation})` : ""}`);
      const summary =
        typeof raw.summary === "string" && raw.summary.trim()
          ? raw.summary
          : `${doneSteps.length} of ${steps.length} runbook steps completed; ${observations.length} observation${observations.length === 1 ? "" : "s"} recorded.`;
      const result = validateDraftReport({ summary, observations, actions, unresolved });
      if (!result.ok) return reject(result.error);
      updated.report = result.value;
      note("system", "Incident report drafted.");
      const { summary: s, observations: o, actions: a, unresolved: u } = result.value;
      return {
        live: updated,
        accepted: true,
        toolResult: { ok: true, message: "incident report drafted; ask the technician to confirm before submitting" },
        publishPayload: { summary: s, observations: o, actions: a, unresolved: u },
        derivedNotes,
      };
    }

    case "report.ready": {
      if (!updated.report) return reject("no report drafted yet");
      updated.report = { ...updated.report, status: "ready_for_review" } satisfies ReportPayload;
      return { live: updated, accepted: true, toolResult: { ok: true, message: "ready for review" }, derivedNotes };
    }

    case "report.submit": {
      const p = event.payload as { technician_confirmed?: unknown } | null;
      const confirmed = p?.technician_confirmed === true || p?.technician_confirmed === "true";
      const result = validateReportSubmit(updated, confirmed);
      if (!result.ok) return reject(result.error);
      updated.report = result.value;
      note("confirmation", "Incident report submitted by technician.");
      return { live: updated, accepted: true, toolResult: { ok: true, message: "report submitted" }, derivedNotes };
    }

    case "session.end": {
      note("system", "Session ended.");
      return { live: updated, accepted: true, derivedNotes };
    }

    default:
      // transcript.* and anything else: no structural change (transcripts live in messages / the hub log).
      return { live: updated, accepted: true, derivedNotes };
  }
}
