import type { Dataset, Event } from "../data/types";

export interface PlanStep {
  /** Dataset time the step happens or must be done by. */
  at: number;
  /** Who acts. */
  who: "operator" | "trucks" | "technician" | "system";
  text: string;
  /** Short mono detail (cost, bbl, well). */
  detail?: string;
  kind: "do" | "arrive" | "watch" | "end";
}

const clock = (t: number) => new Date(t * 1000).toISOString().slice(11, 16) + "Z";

/**
 * The plan of action as a timed checklist, built only from the event's plan and ops.json.
 * Leaks and wear get the inspection steps; pump failures get the priced response laid out
 * minute by minute: when to call, when trucks land, when a well must go off, when repair ends.
 */
export function planSteps(e: Event, ds: Dataset, now: number): PlanStep[] {
  const steps: PlanStep[] = [];
  const opsF = ds.ops.systems[e.system]?.facilities[e.facility];
  const start = e.status === "ongoing" ? now : e.onset_unix;
  const repairH = ds.ops.expected_repair_hours.pump_failure;
  const repairEnd = e.plan?.horizon_end_unix ?? e.onset_unix + repairH * 3600;
  const { truck_capacity_bbl, cost_per_trip } = ds.ops.emergency_trucking;

  if (e.category !== "pump_failure") {
    steps.push({ at: start, who: "operator", text: `Text the on-call technician: ${e.category === "pipeline_leak" ? "pipeline leak" : "pump wearing out"} at ${e.facility}`, kind: "do" });
    steps.push({ at: start + 15 * 60, who: "operator", text: "No reply in 15 min: page the supervisor", kind: "watch" });
    if (e.category === "pipeline_leak") {
      steps.push({ at: start, who: "technician", text: "Stop the pump, close upstream then downstream block valves", kind: "do" });
      steps.push({ at: start + 30 * 60, who: "technician", text: "Walk the right-of-way from the pressure-drop end; photograph; call spill response", kind: "do" });
    } else {
      steps.push({ at: start, who: "technician", text: "Compare discharge psi and flow with commissioning; check strainer, seal, bearings", kind: "do" });
      steps.push({ at: start + 60 * 60, who: "operator", text: "Schedule impeller / wear-ring swap before the forecast fail date", kind: "watch" });
    }
    steps.push({ at: start, who: "system", text: "Tank keeps draining: no shutdown countdown", kind: "watch" });
    return steps.sort((a, b) => a.at - b.at);
  }

  const rec = e.plan?.recommended;
  const trips = rec?.trips_at_unix ?? e.trips_at_unix ?? null;
  const actions = rec?.actions ?? e.actions;
  let anyTruck = false;
  for (const a of actions) {
    if (a.type === "dispatch_truck" && opsF) {
      anyTruck = true;
      steps.push({
        at: start,
        who: "operator",
        text: `Call ${a.trucks} truck${a.trucks === 1 ? "" : "s"} from the ${e.system} yard`,
        detail: `${a.trucks * a.trips_per_truck * truck_capacity_bbl} bbl · $${(a.trucks * a.trips_per_truck * cost_per_trip).toLocaleString("en-US")}`,
        kind: "do",
      });
      for (let k = 0; k < a.trips_per_truck; k++) {
        const at = start + (opsF.response_min + k * opsF.cycle_min) * 60;
        steps.push({
          at,
          who: "trucks",
          text: k === 0 ? `Truck${a.trucks === 1 ? "" : "s"} arrive at ${e.facility}` : `Trip ${k + 1} arrives`,
          detail: `−${a.trucks * truck_capacity_bbl} bbl`,
          kind: "arrive",
        });
      }
    }
    if (a.type === "shut_in_wells") {
      steps.push({
        at: start + a.start_after_min * 60,
        who: "technician",
        text: `Shut in ${a.wells.join(", ")}`,
        detail: `latest moment that still holds the tank · until ${clock(repairEnd)}`,
        kind: "do",
      });
    }
    if (a.type === "none") {
      steps.push({ at: start, who: "system", text: rec?.feasible ? "No action: the tank holds until repair" : "Accept the trip: wells shut in automatically", kind: "watch" });
    }
  }
  steps.push({ at: start, who: "operator", text: `Text the on-call technician the plan`, detail: rec ? `$${Math.round(rec.cost).toLocaleString("en-US")}` : undefined, kind: "do" });
  steps.push({ at: start + 10 * 60, who: "operator", text: "No reply in 10 min: reminder, then supervisor", kind: "watch" });
  steps.push({ at: start, who: "technician", text: "On arrival: lockout/tagout, breaker, VFD fault code, coupling, prime, one reset", kind: "do" });
  if (e.hours_to_limit?.p50 != null) {
    steps.push({ at: now + e.hours_to_limit.p50 * 3600, who: "system", text: "Tank would reach shutdown if nothing were done", detail: `${ds.network.defaults.tank_limits_pct.shutdown}%`, kind: "watch" });
  }
  if (!rec?.feasible && trips) steps.push({ at: trips, who: "system", text: "Wells shut in automatically", kind: "watch" });
  steps.push({ at: repairEnd, who: "system", text: anyTruck ? "Repair complete; pump restarts; trucks released" : "Repair complete; pump restarts", kind: "end" });
  return steps.sort((a, b) => a.at - b.at || (a.kind === "do" ? -1 : 1));
}
