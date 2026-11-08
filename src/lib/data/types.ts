// ─── Frozen contract ────────────────────────────────────────────────────────
// Changes to this file go in their own PR labelled `contract`. See CLAUDE.md.

export type Category = "pump_failure" | "pipeline_leak" | "pump_degradation";
export type EventStatus = "ongoing" | "resolved";

export type Metric =
  | "inflow_bpd" // facility
  | "water_bpd" // well
  | "status" // well (1 producing / 0 shut in) and pump (0 off / 1 running / 2 fault)
  | "level_pct" // tank
  | "flow_bpd" // pump
  | "discharge_psi" // pump
  | "receive_flow_bpd" // pipeline
  | "pressure_psi"; // pipeline

// ─── network.json ───────────────────────────────────────────────────────────
export interface Well {
  id: string;
  baseline_water_bpd: number;
  oil_bpd: number;
  gas_mcfd: number;
}
export interface Facility {
  id: string;
  lat: number;
  lon: number;
  wells: Well[];
  tank: { id: string; capacity_bbl: number };
  pump: { id: string; max_flow_bpd: number; start_level_pct: number; stop_level_pct: number };
  pipeline: { id: string; max_bpd: number; max_pressure_psi: number };
}
export interface System {
  id: string;
  center: [number, number];
  truck_yard: [number, number];
  disposal_site: { id: string; lat: number; lon: number; pressure_psi: number };
  facilities: Facility[];
}
export interface Network {
  meta?: Record<string, unknown>;
  defaults: { tank_limits_pct: { warning: number; shutdown: number } };
  systems: System[];
}

// ─── ops.json ───────────────────────────────────────────────────────────────
export interface Ops {
  dataset_id?: string;
  prices: { oil_per_bbl: number; gas_per_mcf: number };
  expected_repair_hours: { pump_failure: number };
  emergency_trucking: { truck_capacity_bbl: number; cost_per_trip: number };
  systems: Record<
    string,
    { emergency_fleet_size: number; facilities: Record<string, { response_min: number; cycle_min: number }> }
  >;
}

// ─── Loaded dataset ─────────────────────────────────────────────────────────
export const seriesKey = (assetId: string, metric: Metric | string) => `${assetId}|${metric}`;

export interface Dataset {
  folder: string;
  network: Network;
  ops: Ops;
  /** Unix seconds, ascending, one entry per 5-minute step. */
  ts: Int32Array;
  /** `${asset}|${metric}` → values aligned to `ts` (NaN where missing). */
  series: Map<string, Float64Array>;
  /** Last ts in the file = "now". */
  now: number;
}

// ─── Actions & plans ────────────────────────────────────────────────────────
export type Action =
  | { type: "dispatch_truck"; facility_id: string; trucks: number; trips_per_truck: number }
  | { type: "shut_in_wells"; wells: string[]; start_after_min: number }
  | { type: "field_inspection"; asset_id: string }
  | { type: "none" };

export interface LevelPoint {
  t_unix: number;
  level_pct: number;
}

export interface PlanOption {
  /** Human label, e.g. "1 truck, 1 trip" or "Shut in S2_WELL_A1 at +189 min". */
  label: string;
  actions: Action[];
  cost: number;
  /** False when the tank still trips under this option. */
  feasible: boolean;
  peak_level_pct: number;
  trips_at_unix: number | null;
  /** Projected tank level over the horizon, for the plan-comparison chart. */
  curve: LevelPoint[];
}

export interface Plan {
  recommended: PlanOption;
  /** Every other option considered (do nothing, each shut-in, each truck combo, mixes), sorted by cost. */
  alternatives: PlanOption[];
  /** Trucks this plan takes from the system fleet (for the joint allocation view). */
  trucks_used: number;
  /** Repair-end timestamp used as horizon. */
  horizon_end_unix: number;
}

// ─── Events ─────────────────────────────────────────────────────────────────
export interface HoursToLimit {
  p10: number;
  p50: number;
  p90: number;
}

export interface Event {
  /** Stable id in onset order, e.g. "EV-0001". */
  id: string;
  system: string;
  facility: string;
  asset: string;
  category: Category;
  onset_unix: number;
  end_unix: number | null;
  status: EventStatus;
  /** 0..1 */
  confidence: number;
  /** Plain-English reasons, shown in the UI and spoken by Gemini. */
  evidence: string[];
  /** Tank level at "now" (ongoing) or at onset (resolved). Pump failures only. */
  level_pct?: number;
  /** Hours until the tank reaches `shutdown` if nothing is done. Null for leaks/degradation. */
  hours_to_limit?: HoursToLimit | null;
  hours_to_warning?: number | null;
  trips_at_unix?: number | null;
  /** Lost production value if this facility shuts in, $/hr. */
  lost_revenue_per_hr?: number;
  /** Pump failures: the optimiser's output. Others: a single field_inspection action. */
  plan?: Plan;
  actions: Action[];
  /** Learned early-warning scorer's probability for this event's category (ongoing drift events). */
  ml_probability?: number;
}

/** A fault the learned scorer sees forming before the rule-based detector confirms it. */
export interface EarlyWarning {
  facility: string;
  system: string;
  asset: string;
  category: Exclude<Category, "pump_failure">;
  /** 0..1 */
  probability: number;
  as_of_unix: number;
  note: string;
}

export interface DegradationForecast {
  pump_id: string;
  facility: string;
  /** Running-flow ratio decline per hour (negative). */
  slope_per_hr: number;
  /** When pump flow drops below facility inflow → tank can no longer drain. Null if slope ≥ 0. */
  cannot_drain_unix: number | null;
  /** When ratio reaches the configured failure band. */
  predicted_fail_unix: number | null;
  confidence: number;
}

export interface Analysis {
  folder: string;
  now: number;
  /** Every event detected up to `now`, onset order. */
  events: Event[];
  /** Ongoing events in SPEC alert order. */
  alerts: Event[];
  forecasts: DegradationForecast[];
  /** Per system: fleet size and trucks committed by the joint plan at `now`. */
  fleet: Record<string, { size: number; committed: number }>;
  /** Learned early warnings (empty when the model is untrained). */
  warnings?: EarlyWarning[];
}

export type AnalyseFn = (dataset: Dataset, nowOverride?: number) => Analysis;
