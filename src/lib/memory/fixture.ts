import type { Action, Event, Facility, LevelPoint, Ops, Plan, PlanOption, System } from "@/lib/data/types";
import type { EventContext } from "@/lib/events";

// Hand-written stand-in until analyse() produces real events. Facility shapes follow the public
// examples in fixtures/examples.md; every event, reading and plan number here is invented.
const H = 3600;
export const FIXTURE_NOW = 1791768300; // 2026-10-12T01:25:00Z, a Monday night shift

const FACILITY_A: Facility = {
  id: "S1_FACILITY_A",
  lat: 31.912,
  lon: -102.34,
  wells: [
    { id: "S1_WELL_A1", baseline_water_bpd: 1000, oil_bpd: 280, gas_mcfd: 1000 },
    { id: "S1_WELL_A2", baseline_water_bpd: 800, oil_bpd: 490, gas_mcfd: 1750 },
    { id: "S1_WELL_A3", baseline_water_bpd: 600, oil_bpd: 630, gas_mcfd: 2250 },
  ],
  tank: { id: "S1_TANK_A", capacity_bbl: 1200 },
  pump: { id: "S1_PUMP_A", max_flow_bpd: 3600, start_level_pct: 70, stop_level_pct: 30 },
  pipeline: { id: "S1_PIPELINE_A", max_bpd: 4000, max_pressure_psi: 1700 },
};

const FACILITY_C: Facility = {
  id: "S1_FACILITY_C",
  lat: 31.79,
  lon: -102.25,
  wells: [
    { id: "S1_WELL_C1", baseline_water_bpd: 450, oil_bpd: 560, gas_mcfd: 2000 },
    { id: "S1_WELL_C2", baseline_water_bpd: 700, oil_bpd: 170, gas_mcfd: 600 },
    { id: "S1_WELL_C3", baseline_water_bpd: 650, oil_bpd: 390, gas_mcfd: 1400 },
  ],
  tank: { id: "S1_TANK_C", capacity_bbl: 800 },
  pump: { id: "S1_PUMP_C", max_flow_bpd: 2700, start_level_pct: 70, stop_level_pct: 30 },
  pipeline: { id: "S1_PIPELINE_C", max_bpd: 3000, max_pressure_psi: 1550 },
};

const SYSTEM: System = {
  id: "S1",
  center: [31.85, -102.3],
  truck_yard: [31.65, -102.6],
  disposal_site: { id: "S1_DISPOSAL", lat: 31.87, lon: -102.295, pressure_psi: 1050 },
  facilities: [FACILITY_A, FACILITY_C],
};

const OPS: Ops = {
  prices: { oil_per_bbl: 60, gas_per_mcf: 3 },
  expected_repair_hours: { pump_failure: 6 },
  emergency_trucking: { truck_capacity_bbl: 150, cost_per_trip: 905 },
  systems: {
    S1: {
      emergency_fleet_size: 2,
      facilities: {
        S1_FACILITY_A: { response_min: 75, cycle_min: 240 },
        S1_FACILITY_C: { response_min: 75, cycle_min: 230 },
      },
    },
  },
};

const LIMITS = { warning: 85, shutdown: 92 };

/** Straight-line tank curve with step removals, 30-minute points. */
function curve(start: number, from: number, ptsPerHr: number, hours: number, drops: Array<[atHr: number, pts: number]> = []): LevelPoint[] {
  const out: LevelPoint[] = [];
  for (let h = 0; h <= hours; h += 0.5) {
    const removed = drops.filter(([at]) => at <= h).reduce((s, [, p]) => s + p, 0);
    out.push({ t_unix: start + h * H, level_pct: Math.min(LIMITS.shutdown, +(from + ptsPerHr * h - removed).toFixed(1)) });
  }
  return out;
}

const option = (label: string, actions: Action[], cost: number, feasible: boolean, peak: number, trips_at_unix: number | null, pts: LevelPoint[]): PlanOption => ({
  label,
  actions,
  cost,
  feasible,
  peak_level_pct: peak,
  trips_at_unix,
  curve: pts,
});

// Pump failure at FACILITY_A: 2,391 bpd into a 1,200 bbl tank = 8.3 pts/h with the pump stopped.
const PUMP_ONSET = FIXTURE_NOW - 4800; // 00:05 UTC, 1 h 20 min ago
const PUMP_HORIZON = PUMP_ONSET + 6 * H; // repair expected to end 06:05 UTC
const TRIPS_AT = FIXTURE_NOW + Math.round(2.63 * H); // ~04:03 UTC
const REMAINING_H = (PUMP_HORIZON - FIXTURE_NOW) / H; // 4.67 h

const PUMP_PLAN: Plan = {
  recommended: option(
    "2 trucks, 1 trip each",
    [{ type: "dispatch_truck", facility_id: FACILITY_A.id, trucks: 2, trips_per_truck: 1 }],
    1810,
    true,
    84.0,
    null,
    curve(FIXTURE_NOW, 70.2, 8.3, REMAINING_H, [[1.25, 25]]),
  ),
  alternatives: [
    option(
      "1 truck, 1 trip + shut in S1_WELL_A1 at +150 min",
      [
        { type: "dispatch_truck", facility_id: FACILITY_A.id, trucks: 1, trips_per_truck: 1 },
        { type: "shut_in_wells", wells: ["S1_WELL_A1"], start_after_min: 150 },
      ],
      2695,
      true,
      88.9,
      null,
      curve(FIXTURE_NOW, 70.2, 8.3, REMAINING_H, [[1.25, 12.5]]),
    ),
    option("Do nothing", [{ type: "none" }], 8370, false, 92, TRIPS_AT, curve(FIXTURE_NOW, 70.2, 8.3, REMAINING_H)),
    option(
      "Shut in S1_WELL_A1 and S1_WELL_A2 at +40 min",
      [{ type: "shut_in_wells", wells: ["S1_WELL_A1", "S1_WELL_A2"], start_after_min: 40 }],
      9075,
      true,
      84.2,
      null,
      curve(FIXTURE_NOW, 70.2, 2.05, REMAINING_H),
    ),
  ],
  trucks_used: 2,
  horizon_end_unix: PUMP_HORIZON,
};

const PUMP: Event = {
  id: "FIX-PUMP",
  system: "S1",
  facility: FACILITY_A.id,
  asset: FACILITY_A.pump.id,
  category: "pump_failure",
  onset_unix: PUMP_ONSET,
  end_unix: null,
  status: "ongoing",
  confidence: 0.97,
  evidence: [
    "S1_PUMP_A status 2 (fault) since 00:05 UTC; pump flow 0 bpd",
    "Discharge pressure fell from 1,198 to 1,049 psi, the disposal-site pressure",
    "S1_TANK_A rising 0.69 pts per 5 min on 2,391 bpd inflow with the pump stopped",
  ],
  level_pct: 70.2,
  hours_to_limit: { p10: 2.4, p50: 2.6, p90: 2.9 },
  hours_to_warning: 1.8,
  trips_at_unix: TRIPS_AT,
  lost_revenue_per_hr: 4125,
  plan: PUMP_PLAN,
  actions: PUMP_PLAN.recommended.actions,
};

const LEAK: Event = {
  id: "FIX-LEAK",
  system: "S1",
  facility: FACILITY_C.id,
  asset: FACILITY_C.pipeline.id,
  category: "pipeline_leak",
  onset_unix: FIXTURE_NOW - 9 * H, // 16:25 UTC the previous afternoon
  end_unix: null,
  status: "ongoing",
  confidence: 0.88,
  evidence: [
    "Receive flow is 6.2 % below pump flow for 7 h (2,521 vs 2,688 bpd)",
    "S1_PIPELINE_C pressure 1,071 psi, 29 psi under its running baseline",
    "Pump discharge unchanged at 1,197 psi, so the loss is downstream of the pump",
  ],
  hours_to_limit: null,
  actions: [{ type: "field_inspection", asset_id: FACILITY_C.pipeline.id }],
};

const inspection = (asset: string): Action[] => [{ type: "field_inspection", asset_id: asset }];
const dispatch = (facility: string, trucks: number, trips: number): Action[] => [
  { type: "dispatch_truck", facility_id: facility, trucks, trips_per_truck: trips },
];

/** Resolved history so incident memory has something to retrieve. */
const HISTORY: Event[] = [
  {
    id: "FIX-H1",
    system: "S1",
    facility: "S1_FACILITY_B",
    asset: "S1_PUMP_B",
    category: "pump_failure",
    onset_unix: FIXTURE_NOW - 71 * H,
    end_unix: FIXTURE_NOW - 65 * H,
    status: "resolved",
    confidence: 0.95,
    evidence: ["S1_PUMP_B status 2; discharge collapsed to disposal pressure"],
    level_pct: 61.0,
    hours_to_limit: { p10: 2.9, p50: 3.1, p90: 3.4 },
    lost_revenue_per_hr: 3250,
    plan: {
      recommended: option("1 truck, 1 trip", dispatch("S1_FACILITY_B", 1, 1), 905, true, 86.2, null, []),
      alternatives: [],
      trucks_used: 1,
      horizon_end_unix: FIXTURE_NOW - 65 * H,
    },
    actions: dispatch("S1_FACILITY_B", 1, 1),
  },
  {
    id: "FIX-H2",
    system: "S3",
    facility: "S3_FACILITY_A",
    asset: "S3_PUMP_A",
    category: "pump_failure",
    onset_unix: FIXTURE_NOW - 120 * H,
    end_unix: FIXTURE_NOW - 114 * H,
    status: "resolved",
    confidence: 0.93,
    evidence: ["S3_PUMP_A status 2 with the tank already at 78 %"],
    level_pct: 78.4,
    hours_to_limit: { p10: 1.2, p50: 1.4, p90: 1.6 },
    lost_revenue_per_hr: 2980,
    plan: {
      recommended: option("Shut in S3_WELL_A2 at +20 min", [{ type: "shut_in_wells", wells: ["S3_WELL_A2"], start_after_min: 20 }], 1180, true, 90.1, null, []),
      alternatives: [],
      trucks_used: 0,
      horizon_end_unix: FIXTURE_NOW - 114 * H,
    },
    actions: [{ type: "shut_in_wells", wells: ["S3_WELL_A2"], start_after_min: 20 }],
  },
  {
    id: "FIX-H3",
    system: "S2",
    facility: "S2_FACILITY_C",
    asset: "S2_PIPELINE_C",
    category: "pipeline_leak",
    onset_unix: FIXTURE_NOW - 50 * H,
    end_unix: FIXTURE_NOW - 36 * H,
    status: "resolved",
    confidence: 0.9,
    evidence: ["Receive flow 8.9 % below pump flow; pipeline pressure down 31 psi"],
    hours_to_limit: null,
    actions: inspection("S2_PIPELINE_C"),
  },
];

const EVENTS = [...HISTORY, LEAK, PUMP];

export const FIXTURES: Record<string, EventContext> = {
  "FIX-PUMP": {
    folder: "fixture",
    now: FIXTURE_NOW,
    event: PUMP,
    system: SYSTEM,
    facility: FACILITY_A,
    limits: LIMITS,
    ops: OPS,
    readings: [
      { asset: "S1_FACILITY_A", metric: "inflow_bpd", value: 2391.4 },
      { asset: "S1_TANK_A", metric: "level_pct", value: 70.2 },
      { asset: "S1_PUMP_A", metric: "status", value: 2 },
      { asset: "S1_PUMP_A", metric: "flow_bpd", value: 0 },
      { asset: "S1_PUMP_A", metric: "discharge_psi", value: 1048.9 },
      { asset: "S1_PIPELINE_A", metric: "receive_flow_bpd", value: 0 },
      { asset: "S1_PIPELINE_A", metric: "pressure_psi", value: 1049.6 },
      { asset: "S1_WELL_A1", metric: "water_bpd", value: 992.1 },
      { asset: "S1_WELL_A1", metric: "status", value: 1 },
      { asset: "S1_WELL_A2", metric: "water_bpd", value: 801.3 },
      { asset: "S1_WELL_A2", metric: "status", value: 1 },
      { asset: "S1_WELL_A3", metric: "water_bpd", value: 598.0 },
      { asset: "S1_WELL_A3", metric: "status", value: 1 },
    ],
    events: EVENTS,
    fleet: { size: 2, committed: 2 },
  },
  "FIX-LEAK": {
    folder: "fixture",
    now: FIXTURE_NOW,
    event: LEAK,
    system: SYSTEM,
    facility: FACILITY_C,
    limits: LIMITS,
    ops: OPS,
    readings: [
      { asset: "S1_FACILITY_C", metric: "inflow_bpd", value: 1795.2 },
      { asset: "S1_TANK_C", metric: "level_pct", value: 48.3 },
      { asset: "S1_PUMP_C", metric: "status", value: 1 },
      { asset: "S1_PUMP_C", metric: "flow_bpd", value: 2688.4 },
      { asset: "S1_PUMP_C", metric: "discharge_psi", value: 1197.2 },
      { asset: "S1_PIPELINE_C", metric: "receive_flow_bpd", value: 2521.0 },
      { asset: "S1_PIPELINE_C", metric: "pressure_psi", value: 1071.3 },
      { asset: "S1_WELL_C1", metric: "water_bpd", value: 447.9 },
      { asset: "S1_WELL_C1", metric: "status", value: 1 },
      { asset: "S1_WELL_C2", metric: "water_bpd", value: 698.6 },
      { asset: "S1_WELL_C2", metric: "status", value: 1 },
      { asset: "S1_WELL_C3", metric: "water_bpd", value: 648.7 },
      { asset: "S1_WELL_C3", metric: "status", value: 1 },
    ],
    events: EVENTS,
    fleet: { size: 2, committed: 2 },
  },
};
