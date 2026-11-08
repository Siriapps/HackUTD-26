// Escalation ladder for an alert nobody has answered. Timing is derived from the event's own countdown:
// the less time to shutdown, the shorter the acknowledgement window. Pure: the ticker in wire.ts acts on it.
import type { Event } from "@/lib/data/types";
import { hoursText, money } from "@/lib/format";
import { countdownLine } from "./alert";
import type { OpenAlert } from "./store";

export type StepKind = "reminder" | "supervisor" | "all_hands";
export interface Step {
  level: 1 | 2 | 3;
  kind: StepKind;
  /** Minutes after the alert was sent (wall clock × time scale). */
  afterMin: number;
}

const KINDS: StepKind[] = ["reminder", "supervisor", "all_hands"];
/** Fraction of the earliest time-to-shutdown we allow per rung, clamped to sane minutes. */
const WINDOW_SHARE = 0.15;
const MIN_WINDOW = 5;
const MAX_WINDOW = 20;
/** Leaks / worn pumps have no countdown: a calmer ladder. */
const NO_COUNTDOWN_WINDOW = 30;

export function ackWindowMin(event: Event): number {
  const h = event.hours_to_limit?.p10;
  if (h == null) return NO_COUNTDOWN_WINDOW;
  return Math.min(MAX_WINDOW, Math.max(MIN_WINDOW, h * 60 * WINDOW_SHARE));
}

export function ladder(event: Event): Step[] {
  const w = ackWindowMin(event);
  return KINDS.map((kind, i) => ({ level: (i + 1) as Step["level"], kind, afterMin: w * (i + 1) }));
}

/** Has a human replied on this alert (any inbound text)? Escalation is for silence only. */
const engaged = (a: OpenAlert) => a.log.some((l) => l.dir === "in");

/**
 * Next step to fire now, or null. Stops once anyone replies or a decision exists; HELP
 * (status "escalated") jumps straight to the supervisor rung.
 */
export function dueStep(a: OpenAlert, event: Event, nowMs: number, timeScale = 1): Step | null {
  if (a.status === "resolved" || a.status === "approved" || event.status === "resolved") return null;
  const steps = ladder(event);
  const level = a.escalation ?? 0;
  if (a.status === "escalated") return level < 2 ? steps[1] : null;
  if (engaged(a)) return null;
  const next = steps[level];
  if (!next) return null;
  const elapsedMin = ((nowMs - a.sentAt) / 60000) * timeScale;
  return elapsedMin >= next.afterMin ? next : null;
}

/**
 * The dataset clock is frozen at its last row; while an alert waits, the real countdown keeps running.
 * Shift "now" forward and shrink hours_to_limit by the elapsed time so "shutdown in" counts down
 * while "at HH:MM" stays put.
 */
export function elapsedView(event: Event, now: number, elapsedSec: number): [Event, number] {
  const h = event.hours_to_limit;
  if (!h || elapsedSec <= 0) return [event, now];
  const d = elapsedSec / 3600;
  const shrink = (x: number) => Math.max(0, x - d);
  return [{ ...event, hours_to_limit: { p10: shrink(h.p10), p50: shrink(h.p50), p90: shrink(h.p90) } }, now + elapsedSec];
}

export function composeEscalation(
  step: Step,
  a: OpenAlert,
  event: Event,
  now: number,
  opts: { nowMs: number; techName?: string; nextInMin?: number; timeScale?: number },
) {
  const cd = countdownLine(...elapsedView(event, now, (opts.nowMs - a.sentAt) / 1000 * (opts.timeScale ?? 1))) ?? "";
  const rec = event.plan?.recommended;
  const plan = rec ? `Plan: ${rec.label}, ${money(rec.cost)}.` : `Action: inspect ${event.asset}.`;
  const tech = opts.techName ?? `on-call tech (…${a.handle.slice(-4)})`;
  const waited = hoursText((opts.nowMs - a.sentAt) / 3_600_000);
  const help = a.log.filter((l) => l.dir === "in" && l.intent === "help").at(-1)?.text;

  switch (step.kind) {
    case "reminder":
      return [
        `⏰ ${a.eventId} still needs you. ${cd}`,
        plan,
        `Reply YES to approve or HELP.${opts.nextInMin ? ` Supervisor gets paged in ${Math.round(opts.nextInMin)} min.` : ""}`,
      ].join("\n");
    case "supervisor":
      return [
        `⚠️ ESCALATED ${a.eventId} · ${event.facility} (${event.system})`,
        help ? `${tech} asked for help: "${help}"` : `${tech} hasn't answered in ${waited}.`,
        cd,
        plan,
        "Reply YES to approve for them, NO for options, ? for status.",
      ]
        .filter(Boolean)
        .join("\n");
    case "all_hands":
      return [`🚨 ${a.eventId} STILL UNACKNOWLEDGED after ${waited}. ${cd}`, plan, "First YES from anyone on this thread approves it."].join("\n");
  }
}
