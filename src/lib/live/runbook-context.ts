/**
 * Deterministic, event-tailored runbook for the Gemini Live glasses session.
 *
 * The STEPS are fixed (same list, same order as the server seeds into the runbook pane, so step_index always matches
 * what the operator sees). What changes per event is the facts attached to each step: asset ids, the readings at "now",
 * the countdown and the console's plan. Every number comes from the EventContext; nothing is invented here.
 */
import type { EventContext } from "@/lib/events";
import { hoursText, money, pct, utc } from "@/lib/format";
import { CATEGORY_LABEL, RUNBOOKS } from "@/lib/memory/incidents";
import { GENERAL_RUNBOOK } from "./processor";

const MAX_EVIDENCE = 3;

function readingOf(ctx: EventContext, asset: string, metric: string): number | undefined {
  return ctx.readings.find((r) => r.asset === asset && r.metric === metric)?.value;
}
const num = (v: number | undefined, unit: string, digits = 0) =>
  v == null ? "no reading on record" : `${v.toLocaleString("en-US", { maximumFractionDigits: digits })} ${unit}`;

/** One tailored sentence per runbook step (same indexes as RUNBOOKS[category].steps); "" when there is nothing specific. */
function stepFacts(ctx: EventContext): string[] {
  const { event: e, facility: f, system: s } = ctx;
  const pump = f.pump.id;
  const pipe = f.pipeline.id;
  const tank = f.tank.id;
  const status = readingOf(ctx, pump, "status");
  const flow = readingOf(ctx, pump, "flow_bpd");
  const discharge = readingOf(ctx, pump, "discharge_psi");
  const receive = readingOf(ctx, pipe, "receive_flow_bpd");
  const pressure = readingOf(ctx, pipe, "pressure_psi");
  const level = readingOf(ctx, tank, "level_pct") ?? e.level_pct;
  const disposal = s.disposal_site.pressure_psi;
  const since = utc(e.onset_unix);
  const countdown = e.hours_to_limit
    ? `Tank ${tank} is at ${pct(level ?? NaN)} and reaches the ${ctx.limits.shutdown} % shutdown in about ${hoursText(e.hours_to_limit.p50)} (range ${e.hours_to_limit.p10.toFixed(1)}-${e.hours_to_limit.p90.toFixed(1)} h).`
    : `No countdown: ${tank} is at ${pct(level ?? NaN)} and still draining normally.`;
  const plan = e.plan
    ? `Console plan: ${e.plan.recommended.label} for ${money(e.plan.recommended.cost)}; repair expected to end ${utc(e.plan.horizon_end_unix)}.`
    : "";

  switch (e.category) {
    case "pump_failure":
      return [
        `${pump} reports status ${status ?? "?"} (fault) since ${since}; flow ${num(flow, "bpd")} and discharge ${num(discharge, "psi")}. Discharge near the disposal pressure (${disposal} psi) means it is not pumping.`,
        `Ask for the VFD fault code on ${pump} and have them read it out exactly; log it.`,
        `${pump} stopped at ${since}; ask whether the motor housing is hot to the hand or smells burnt (only after lockout/tagout).`,
        `Check the coupling between motor and ${pump}: loose, sheared, or misaligned.`,
        `Suction side of ${pump}: ${tank} is at ${pct(level ?? NaN)}, so there should be suction head. Ask whether the pump is primed.`,
        `One reset only on ${pump}, then confirm status and flow. ${countdown}`,
        `${countdown} ${plan} Compare the mechanic's ETA with the repair end time.`,
        `${plan || "Trucks are priced by the console."} Confirm with the technician that they agree, then call confirm_plan.`,
      ];
    case "pipeline_leak":
      return [
        `${pump} flow ${num(flow, "bpd")} against ${pipe} receive flow ${num(receive, "bpd")}; the gap is the suspected loss.`,
        `Close the block valve upstream first, then downstream, on ${pipe}. Ask which valves they can see.`,
        `${pipe} pressure is ${num(pressure, "psi", 1)}; a running pipeline normally sits near ${disposal + 50} psi, so the drop marks the leak. Start walking from the low-pressure end.`,
        `Photograph any wet ground, staining or bubbling along ${pipe}; log the location in the technician's words.`,
        `Spill response and the regulator: ask whether they have been called and log who and when.`,
        `Vac truck recovery for ${pipe}: ask whether one is on site or on the way.`,
      ];
    case "pump_degradation":
      return [
        `${pump} discharge ${num(discharge, "psi")} and flow ${num(flow, "bpd")}; compare them with the commissioning values on the nameplate.`,
        `Check the suction strainer on ${pump} for debris.`,
        `Look for weeping at the ${pump} seal.`,
        `Feel (carefully, guarded) for bearing heat on ${pump}.`,
        `Listen for gravel-like cavitation noise from ${pump}.`,
        `${plan || "Schedule the impeller / wear-ring swap before the forecast failure date."}`,
      ];
  }
}

/** The system-prompt section: deterministic steps plus the event facts for each. Safe for events with no telemetry. */
export function buildLiveRunbookContext(ctx: EventContext | null, eventId: string): string {
  if (!ctx) {
    return [
      `RUNBOOK (general; no telemetry is on record for ${eventId}). Follow these steps exactly, in this order. Do not add, skip, merge or reorder steps. Step 1 is step_index 0.`,
      ...GENERAL_RUNBOOK.steps.map((t, i) => `${i + 1}) ${t}`),
      `Rule: ${GENERAL_RUNBOOK.rule}`,
      `This is a NEW incident opened from the glasses. You know nothing about it yet beyond the id ${eventId}: start by asking what asset it is and what is wrong. Never invent readings, ids or history.`,
    ].join("\n");
  }
  const { event: e } = ctx;
  const rb = RUNBOOKS[e.category] ?? { steps: [], rule: "" };
  const facts = stepFacts(ctx);
  return [
    `RUNBOOK (${CATEGORY_LABEL[e.category]} on ${e.asset}, ${ctx.facility.id}). Follow these steps exactly, in this order, one at a time. Do not add, skip, merge or reorder steps; the operator's screen shows this same list. Step 1 is step_index 0. The note under each step is fact about THIS incident: use it to be specific, and never go beyond it.`,
    ...rb.steps.flatMap((t, i) => [`${i + 1}) ${t}`, ...(facts[i] ? [`   Facts: ${facts[i]}`] : [])]),
    `Rule: ${rb.rule}`,
    ...(e.evidence.length ? [`Why this was flagged: ${e.evidence.slice(0, MAX_EVIDENCE).join("; ")}.`] : []),
    `You already know the asset (${e.asset}), the facility (${ctx.facility.id}) and the numbers above; do not ask the technician for them again. Ask only for what the sensors cannot tell you (what they see, hear and read off gauges).`,
  ].join("\n");
}

