import { Type, type FunctionDeclaration } from "@google/genai";
import type { Action } from "@/lib/data/types";
import type { EventContext } from "@/lib/events";
import { hoursText, money, pct, utc } from "@/lib/format";
import { CATEGORY_LABEL, RUNBOOKS, similar, type Incident } from "./incidents";

/** One plain-English line per action, with the real clock times behind it. */
export function describeActions(actions: Action[], ctx: EventContext): string[] {
  const facOps = ctx.ops.systems[ctx.system.id]?.facilities[ctx.facility.id];
  const trucking = ctx.ops.emergency_trucking;
  return actions.map((a) => {
    switch (a.type) {
      case "dispatch_truck": {
        const first = facOps ? `, first arrival ${utc(ctx.now + facOps.response_min * 60)} (+${facOps.response_min} min)` : "";
        return `Send ${a.trucks} truck${a.trucks === 1 ? "" : "s"}, ${a.trips_per_truck} trip${a.trips_per_truck === 1 ? "" : "s"} each${first}; ${trucking.truck_capacity_bbl} bbl per trip`;
      }
      case "shut_in_wells":
        return `Shut in ${a.wells.join(" and ")} from ${utc(ctx.now + a.start_after_min * 60)} (+${a.start_after_min} min) until the repair ends`;
      case "field_inspection":
        return `Inspect ${a.asset_id}`;
      case "none":
        return "Nothing: the tank peaks below the shutdown limit";
    }
  });
}

/** System instruction for Gemini Live and the snapshot fallback. Every number comes from the EventContext. */
export function buildBriefing(ctx: EventContext, incidents: Incident[] = similar(ctx.event, ctx)): string {
  const { event: e, facility: f, system: s } = ctx;
  const facOps = ctx.ops.systems[s.id]?.facilities[f.id];
  const label = CATEGORY_LABEL[e.category];
  const elapsed = hoursText((ctx.now - e.onset_unix) / 3600);
  const runbook = RUNBOOKS[e.category];
  const plan = e.plan;

  const tank = e.hours_to_limit
    ? [
        `TANK: ${pct(e.level_pct ?? NaN)} now and rising. Shutdown (${ctx.limits.shutdown} %) in ${hoursText(e.hours_to_limit.p50)} ` +
          `(range ${e.hours_to_limit.p10.toFixed(1)}-${e.hours_to_limit.p90.toFixed(1)} h), at about ${utc(ctx.now + e.hours_to_limit.p50 * 3600)}.` +
          (e.hours_to_warning != null ? ` Warning (${ctx.limits.warning} %) in ${hoursText(e.hours_to_warning)}.` : "") +
          (plan ? ` Repair expected to end ${utc(plan.horizon_end_unix)}.` : "") +
          (e.lost_revenue_per_hr != null ? ` If the facility shuts in it loses ${money(e.lost_revenue_per_hr)} per hour.` : ""),
      ]
    : ["TANK: no countdown. The pump is still running, so the tank is draining normally."];

  const planLines = plan
    ? [
        `RECOMMENDED PLAN, ${money(plan.recommended.cost)}: ${plan.recommended.label}.`,
        ...describeActions(plan.recommended.actions, ctx).map((l) => `- ${l}`),
        `- Projected tank peak ${pct(plan.recommended.peak_level_pct)}; trucks committed from the ${s.id} fleet: ${plan.trucks_used}.`,
        ...(plan.alternatives.length
          ? ["OTHER OPTIONS CONSIDERED:", ...plan.alternatives.slice(0, 4).map((o) => `- ${o.label}: ${money(o.cost)}, ${o.feasible ? "holds" : "tank still trips"}`)]
          : []),
      ]
    : [`RECOMMENDED ACTION: ${describeActions(e.actions, ctx).join("; ")}.`];

  return [
    `You are Avon's night-shift field assistant on a live call with a lone technician standing at ${f.id} (system ${s.id}) at night.`,
    "Rules: be concrete and brief. Short sentences, one instruction at a time, numbers with units. Everything you say about readings, the countdown and the plan must come from this briefing; never invent, estimate or round away a reading that is not here. If something is not in the briefing, say so and ask the technician to read it off the gauge. When the camera shows equipment, say what you see and tie it to the runbook step. Safety first: lockout/tagout before anything is touched.",
    "Tools: call confirm_plan when the technician agrees to carry out the plan; log_observation for anything they report or you see; escalate when they need help or the situation no longer matches the plan; get_past_incidents when they ask what happened before.",
    "",
    `FACILITY ${f.id}: ${f.wells.length} wells (${f.wells.map((w) => w.id).join(", ")}); tank ${f.tank.id} ${f.tank.capacity_bbl.toLocaleString("en-US")} bbl, warning ${ctx.limits.warning} %, shutdown ${ctx.limits.shutdown} %; pump ${f.pump.id} rated ${f.pump.max_flow_bpd.toLocaleString("en-US")} bpd; pipeline ${f.pipeline.id} to ${s.disposal_site.id} at ${s.disposal_site.pressure_psi} psi.`,
    `TRUCKS: ${s.id} fleet of ${ctx.fleet?.size ?? ctx.ops.systems[s.id]?.emergency_fleet_size ?? "?"}` +
      (ctx.fleet ? `, ${ctx.fleet.committed} committed` : "") +
      (facOps ? `; first arrival ${facOps.response_min} min after the call, then every ${facOps.cycle_min} min` : "") +
      `; ${ctx.ops.emergency_trucking.truck_capacity_bbl} bbl per trip at ${money(ctx.ops.emergency_trucking.cost_per_trip)}. Expected pump repair ${ctx.ops.expected_repair_hours.pump_failure} h from onset.`,
    "",
    `EVENT ${e.id}: ${label} on ${e.asset}, started ${utc(e.onset_unix)} (${elapsed} ago), ${e.status}, confidence ${Math.round(e.confidence * 100)} %.`,
    ...e.evidence.map((x, i) => `Evidence ${i + 1}: ${x}`),
    ...tank,
    `READINGS at ${utc(ctx.now)}: ${ctx.readings.map((r) => `${r.asset} ${r.metric} ${+r.value.toFixed(1)}`).join("; ")}.`,
    "",
    ...planLines,
    "",
    `RUNBOOK (${label}): ${runbook.steps.map((st, i) => `${i + 1}) ${st}`).join(" ")} Rule: ${runbook.rule}`,
    "",
    "PAST INCIDENTS, most similar first:",
    ...(incidents.length ? incidents.map((i) => `- ${i.summary} -> ${i.outcome}`) : ["- none on record yet"]),
  ].join("\n");
}

/** Function tools the live session exposes; handled client-side in LiveSession. */
export const FIELD_TOOLS: FunctionDeclaration[] = [
  {
    name: "confirm_plan",
    description: "The technician confirms they will carry out the recommended plan. Call it once, when they say so.",
    parameters: { type: Type.OBJECT, properties: { note: { type: Type.STRING, description: "Optional short note in the technician's words" } } },
  },
  {
    name: "log_observation",
    description: "Record something the technician reports or the camera shows: a fault code, breaker state, leak location, a gauge reading.",
    parameters: { type: Type.OBJECT, properties: { text: { type: Type.STRING, description: "One or two sentences" } }, required: ["text"] },
  },
  {
    name: "escalate",
    description: "Alert the operations channel that the technician needs help or the plan no longer holds.",
    parameters: { type: Type.OBJECT, properties: { reason: { type: Type.STRING, description: "Why, in one sentence" } }, required: ["reason"] },
  },
  {
    name: "get_past_incidents",
    description: "Fetch the most similar past incidents and how they were resolved.",
  },
];
