/**
 * "Action Items for Operators": what the crew coming on shift should do first about THIS event.
 *
 * Derived only from what the app already knows (the event analysis, the dispatch thread, the runbook, notes and report),
 * so it agrees with the morning handoff (`dispatchLog`). Pure and deterministic: callers pass `nowMs`.
 *
 * Order, most critical first:
 *   Do first : technician needs help → nobody decided / nobody alerted → countdown → blocked steps → help notes
 *   Then     : verify the approved plan or the overnight fix → resume the stopped call → report → unresolved
 *   Context  : overnight summary, why it was flagged, cost, latest observations
 *   Handled  : what is already done
 */
import type { Event } from "@/lib/data/types";
import { hoursText, money } from "@/lib/format";
import { CATEGORY_LABEL } from "@/lib/memory/incidents";
import type { NoteEntry, ReportPayload, RunbookState } from "./types";

export type ActionTone = "urgent" | "next" | "info" | "done";

export interface ActionItem {
  id: string;
  tone: ActionTone;
  title: string;
  detail?: string;
}

/** The slice of the On-call thread (OpenAlert) the card needs. */
export interface ThreadSummary {
  status: "awaiting" | "approved" | "rejected" | "resolved" | "escalated";
  sentAt: number;
  choice?: { label: string; cost: number };
  decidedBy?: string;
  decidedAt?: number;
  ackAt?: number;
  escalation?: number;
  resolution?: { at: number; by: string; notes: string[]; photos: string[] };
}

export interface ActionItemInput {
  event?: Event;
  thread?: ThreadSummary | null;
  runbook: RunbookState | null;
  notes: NoteEntry[];
  report: ReportPayload | null;
  /** True while a glasses call is connected. */
  sessionLive?: boolean;
  /** Wall clock in ms, for "how long has this waited". */
  nowMs?: number;
}

const ORDER: Record<ActionTone, number> = { urgent: 0, next: 1, info: 2, done: 3 };
const MAX_UNRESOLVED = 4;
const MAX_OBSERVATIONS = 3;
const RUNG = ["", "the on-call was reminded", "the supervisor was paged", "everyone was paged"];

const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const since = (ms: number, nowMs: number) => {
  const m = Math.max(0, Math.round((nowMs - ms) / 60_000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
};

export function buildActionItems({ event, thread, runbook, notes, report, sessionLive = false, nowMs = Date.now() }: ActionItemInput): ActionItem[] {
  const items: ActionItem[] = [];
  const add = (it: ActionItem) => items.push(it);
  const steps = runbook?.steps ?? [];
  const open = !thread || thread.status !== "resolved";
  const ongoing = event?.status === "ongoing";
  const plan = event?.plan?.recommended;
  const countdown = ongoing && event?.hours_to_limit ? hoursText(event.hours_to_limit.p50) : null;
  const decided = !!thread?.choice;

  // ── Do first ───────────────────────────────────────────────────────────────
  if (thread && thread.status === "escalated") {
    add({
      id: "escalated",
      tone: "urgent",
      title: "Call the technician back: they asked for help",
      detail: `${RUNG[thread.escalation ?? 0] ? `Escalated: ${RUNG[thread.escalation ?? 0]}. ` : ""}${thread.ackAt ? "Someone acknowledged it." : "Nobody has acknowledged it yet."}`,
    });
  }

  if (open && ongoing) {
    if (!thread) {
      add({
        id: "not-alerted",
        tone: "urgent",
        title: "Nobody has been alerted about this event",
        detail: `${countdown ? `Tank shutdown in about ${countdown}. ` : ""}Text the on-call technician from the alert card.${plan ? ` Recommended: ${plan.label} (${money(plan.cost)}).` : ""}`,
      });
    } else if (!decided) {
      add({
        id: "undecided",
        tone: "urgent",
        title: "No decision yet on the plan",
        detail: `Alerted ${since(thread.sentAt, nowMs)} ago at ${hhmm(thread.sentAt)} UTC and nobody has chosen.${countdown ? ` Tank shutdown in about ${countdown}.` : ""}${plan ? ` Recommended: ${plan.label} (${money(plan.cost)}). Approve it on the On-call board.` : " Decide on trucks or shut-ins on the On-call board."}`,
      });
    }
  }

  if (open && !ongoing && event?.status === "resolved") {
    add({
      id: "sensors-resolved",
      tone: "urgent",
      title: "Sensors show this resolved but the thread is still open",
      detail: "Confirm on site that the equipment is running normally, then mark the thread fixed.",
    });
  }

  steps
    .filter((s) => s.status === "blocked")
    .forEach((s) =>
      add({
        id: `blocked-${s.index}`,
        tone: "urgent",
        title: `Unblock step ${s.index + 1}: ${s.text}`,
        detail: s.observation ? `Technician says: ${s.observation}` : "The technician could not do this step.",
      }),
    );
  notes
    .filter((n) => n.kind === "escalation")
    .forEach((n, i) => add({ id: `escalation-${i}`, tone: "urgent", title: "Technician asked for help", detail: n.text }));

  // ── Then ───────────────────────────────────────────────────────────────────
  if (thread && open && decided && thread.choice) {
    add({
      id: "verify-plan",
      tone: "next",
      title: `Verify the approved plan is being carried out: ${thread.choice.label}`,
      detail: `${money(thread.choice.cost)}, approved by ${thread.decidedBy ?? "someone"}${thread.decidedAt ? ` at ${hhmm(thread.decidedAt)} UTC` : ""}.${countdown ? ` Tank shutdown still in about ${countdown} if nothing changes.` : ""} Confirm trucks or shut-ins actually started.`,
    });
  }

  if (thread?.status === "resolved") {
    const r = thread.resolution;
    add({
      id: "verify-fix",
      tone: "next",
      title: "Verify the overnight fix on site",
      detail: r
        ? `Fixed by ${r.by} at ${hhmm(r.at)} UTC.${r.notes.length ? ` Technician wrote: “${r.notes.join(" / ")}”.` : " No notes were left."}${r.photos.length ? ` ${r.photos.length} photo${r.photos.length === 1 ? "" : "s"} attached.` : ""}`
        : "The thread was marked resolved without notes. Ask the technician what was done.",
    });
  }

  if (runbook && steps.length) {
    const done = steps.filter((s) => s.status === "completed").length;
    const next = steps.find((s) => s.status === "in_progress") ?? steps.find((s) => s.status === "pending");
    if (done === steps.length) {
      add({ id: "runbook-done", tone: "done", title: `All ${steps.length} runbook steps completed` });
    } else if (next && done > 0 && !sessionLive) {
      add({
        id: "resume",
        tone: "next",
        title: `The call stopped before the end: pick up at step ${next.index + 1}, ${next.text}`,
        detail: `${done} of ${steps.length} steps were done. Have the technician start a new live call for this event to continue.`,
      });
    } else if (next) {
      add({
        id: "next-step",
        tone: "next",
        title: `${next.status === "in_progress" ? "In progress" : "Next"}: step ${next.index + 1}, ${next.text}`,
        detail: `${done} of ${steps.length} steps done. ${next.status === "in_progress" ? "Confirm it on the runbook once the technician says it is done." : "Waiting for the technician to start it."}`,
      });
    }
  } else if (open) {
    add({
      id: "no-session",
      tone: "next",
      title: "No glasses session yet",
      detail: "The runbook loads when the technician starts a live call for this event.",
    });
  }

  if (!report) {
    if (steps.some((s) => s.status !== "pending")) {
      add({ id: "report-missing", tone: "next", title: "No incident report yet", detail: "Ask the technician to say “finalize the incident report” on the call." });
    }
  } else if (report.status === "draft") {
    add({ id: "report-draft", tone: "next", title: "Review the report draft", detail: "Check the summary and observations, then mark it ready for review." });
  } else if (report.status === "ready_for_review") {
    add({ id: "report-ready", tone: "next", title: "Report is ready for review", detail: "Submit it once you agree with it, or ask the technician to confirm on the call." });
  } else {
    add({ id: "report-submitted", tone: "done", title: "Report submitted", detail: "Close the event on the board and hand it to the morning crew." });
  }
  (report?.unresolved ?? []).slice(0, MAX_UNRESOLVED).forEach((u, i) =>
    add({ id: `unresolved-${i}`, tone: "next", title: "Still unresolved", detail: u }),
  );

  // ── Context ────────────────────────────────────────────────────────────────
  if (thread) {
    const parts = [`alerted ${hhmm(thread.sentAt)} UTC`];
    if (thread.choice) parts.push(`approved ${thread.choice.label} (${money(thread.choice.cost)}) by ${thread.decidedBy ?? "?"}${thread.decidedAt ? ` ${hhmm(thread.decidedAt)}` : ""}`);
    else if (thread.status !== "resolved") parts.push("no decision");
    if ((thread.escalation ?? 0) > 0) parts.push(`escalated ×${thread.escalation}`);
    if (thread.ackAt) parts.push(`acknowledged ${hhmm(thread.ackAt)}`);
    add({ id: "overnight", tone: "info", title: "What happened overnight", detail: `${parts.join("; ")}.` });
  }
  if (event) {
    if (event.evidence.length) {
      add({
        id: "evidence",
        tone: "info",
        title: `Why this was flagged (${CATEGORY_LABEL[event.category]}, ${Math.round(event.confidence * 100)} % confidence)`,
        detail: event.evidence.slice(0, 2).join(". "),
      });
    }
    if (event.lost_revenue_per_hr != null && event.hours_to_limit) {
      add({ id: "cost", tone: "info", title: `Shutting in costs ${money(event.lost_revenue_per_hr)} per hour`, detail: "That is the price of doing nothing once the tank trips." });
    }
  } else {
    add({
      id: "no-telemetry",
      tone: "info",
      title: "No telemetry on record for this event",
      detail: "Everything here comes from what the technician reported. Verify the asset and link it to a dataset event if it is real.",
    });
  }
  const observed = notes.filter((n) => n.kind === "observation").slice(-MAX_OBSERVATIONS);
  if (observed.length) {
    add({ id: "observations", tone: "info", title: "Latest observations from the field", detail: observed.map((n) => n.text).join(" · ") });
  }

  return items.map((it, i) => ({ it, i })).sort((a, b) => ORDER[a.it.tone] - ORDER[b.it.tone] || a.i - b.i).map(({ it }) => it);
}
