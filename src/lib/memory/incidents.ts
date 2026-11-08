import type { Analysis, Category, Event } from "@/lib/data/types";
import { money } from "@/lib/format";
import notes from "./notes.json";

// ─── Labels & runbooks ──────────────────────────────────────────────────────
export const CATEGORY_LABEL: Record<Category, string> = {
  pump_failure: "Pump failure",
  pipeline_leak: "Pipeline leak",
  pump_degradation: "Pump wearing out",
};

export interface Runbook {
  steps: string[];
  /** Standing rule that applies to the whole runbook. */
  rule: string;
}

/** Field runbooks, verbatim from docs/PLAN.md item 12 (split into steps). */
export const RUNBOOKS: Record<Category, Runbook> = {
  pump_failure: {
    steps: [
      "On arrival check breaker/fuse",
      "Check the VFD fault code",
      "Check motor temp",
      "Check the coupling",
      "Check prime",
      "Attempt one reset",
      "If no restart, call the mechanic and confirm ETA against the countdown",
      "Trucks are already priced by the console",
    ],
    rule: "Lockout/tagout before any work.",
  },
  pipeline_leak: {
    steps: [
      "Stop the pump",
      "Close upstream then downstream block valves",
      "Walk the right-of-way from the pressure-drop end",
      "Photograph",
      "Call spill response and the regulator",
      "Vac truck recovery",
    ],
    rule: "Tank keeps being pumped, so no countdown.",
  },
  pump_degradation: {
    steps: [
      "Compare discharge psi and flow with commissioning values",
      "Check the suction strainer",
      "Check seal weep",
      "Check bearing heat",
      "Listen for cavitation noise",
      "Schedule the impeller/wear-ring swap before the console's forecast fail date",
    ],
    rule: "No countdown: the tank is still being pumped.",
  },
};

// ─── Corpus ─────────────────────────────────────────────────────────────────
export interface Incident {
  id: string;
  /** history = resolved event from Analysis; note = team notes.json; field = technician resolution recorded here. */
  source: "history" | "note" | "field";
  category: Category;
  system: string;
  facility?: string;
  level_pct?: number;
  hours_to_limit?: number;
  onset_unix?: number;
  summary: string;
  outcome: string;
}

const TEAM_NOTES = notes as unknown as Omit<Incident, "source">[];

export type NoteKind = "observation" | "confirmation" | "escalation" | "resolution" | "dismissal";
export interface FieldNote {
  eventId: string;
  kind: NoteKind;
  text: string;
  at: number;
}

const NOTES_KEY = "avon.memory.notes";
const FEEDBACK_KEY = "avon.memory.feedback";

// ponytail: localStorage is the whole persistence layer; swap these two for a server store if the team ever shares memory.
function read<T>(key: string, fallback: T): T {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / SSR: memory just doesn't persist */
  }
}

export function fieldNotes(eventId?: string): FieldNote[] {
  const all = read<FieldNote[]>(NOTES_KEY, []);
  return eventId ? all.filter((n) => n.eventId === eventId) : all;
}

export function addFieldNote(eventId: string, kind: NoteKind, text: string): FieldNote {
  const note: FieldNote = { eventId, kind, text: text.trim(), at: Date.now() };
  write(NOTES_KEY, [...fieldNotes(), note]);
  return note;
}

/** Learning loop: what the technician says happened becomes this event's outcome in memory. */
export const recordResolution = (eventId: string, outcomeText: string) => addFieldNote(eventId, "resolution", outcomeText);

export type Feedback = "confirm" | "dismiss";
export type FeedbackCounts = Record<Category, Record<Feedback, number>>;
const emptyCounts = (): FeedbackCounts => ({
  pump_failure: { confirm: 0, dismiss: 0 },
  pipeline_leak: { confirm: 0, dismiss: 0 },
  pump_degradation: { confirm: 0, dismiss: 0 },
});

export const feedbackCounts = (): FeedbackCounts => ({ ...emptyCounts(), ...read<Partial<FeedbackCounts>>(FEEDBACK_KEY, {}) });

export function recordFeedback(category: Category, kind: Feedback): FeedbackCounts {
  const counts = feedbackCounts();
  counts[category] = { ...counts[category], [kind]: counts[category][kind] + 1 };
  write(FEEDBACK_KEY, counts);
  return counts;
}

export function incidentFromEvent(e: Event, resolution?: string): Incident {
  const plan = e.plan?.recommended;
  const hours = e.end_unix ? (e.end_unix - e.onset_unix) / 3600 : null;
  const planText = plan
    ? `Plan: ${plan.label} (${money(plan.cost)}); projected peak ${plan.peak_level_pct.toFixed(0)} %`
    : `Field inspection of ${e.asset}`;
  return {
    id: e.id,
    source: resolution ? "field" : "history",
    category: e.category,
    system: e.system,
    facility: e.facility,
    level_pct: e.level_pct,
    hours_to_limit: e.hours_to_limit?.p50,
    onset_unix: e.onset_unix,
    summary: `${CATEGORY_LABEL[e.category]} on ${e.asset}${e.evidence[0] ? `: ${e.evidence[0]}` : ""}`,
    outcome: (resolution ?? planText) + (hours ? `; cleared after ${hours.toFixed(1)} h` : ""),
  };
}

/** Everything the assistant may cite: resolved history + technician resolutions + team notes. */
export function corpus(analysis: Pick<Analysis, "events">): Incident[] {
  const resolutions = new Map<string, string>();
  for (const n of fieldNotes()) if (n.kind === "resolution") resolutions.set(n.eventId, n.text); // latest wins
  const history = analysis.events
    .filter((e) => e.status === "resolved" || resolutions.has(e.id))
    .map((e) => incidentFromEvent(e, resolutions.get(e.id)));
  return [...history, ...TEAM_NOTES.map((n) => ({ ...n, source: "note" as const }))];
}

// ─── Similarity ─────────────────────────────────────────────────────────────
export const levelBand = (v?: number | null) => (v == null ? null : Math.floor(v / 10) * 10);
export const htlBand = (h?: number | null) => (h == null ? null : h < 2 ? "<2h" : h < 4 ? "2-4h" : h < 8 ? "4-8h" : "8h+");

/** Same category is required; then same system, facility, level band, countdown band; the team's own resolutions rank first on ties. */
export function similarityScore(event: Event, i: Incident): number {
  if (i.category !== event.category) return 0;
  let s = 4;
  if (i.system === event.system) s += 2;
  if (i.facility && i.facility === event.facility) s += 1;
  const lb = levelBand(i.level_pct);
  if (lb !== null && lb === levelBand(event.level_pct)) s += 1;
  const hb = htlBand(i.hours_to_limit);
  if (hb !== null && hb === htlBand(event.hours_to_limit?.p50)) s += 1;
  if (i.source === "field") s += 1;
  return s;
}

export function similar(event: Event, analysis: Pick<Analysis, "events">, k = 3): Incident[] {
  return corpus(analysis)
    .filter((i) => i.id !== event.id)
    .map((i) => [i, similarityScore(event, i)] as const)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([i]) => i);
}
