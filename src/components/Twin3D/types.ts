import type { Category, Event, Facility, Plan } from "@/lib/data/types";

/** Live values for one facility at the displayed moment. Build with `readingsAt(dataset, facility, t)`. */
export interface TwinReadings {
  level_pct: number;
  /** 0 off, 1 running, 2 fault. */
  pump_status: number;
  flow_bpd: number;
  discharge_psi: number;
  receive_flow_bpd: number;
  pressure_psi: number;
  inflow_bpd: number;
}

export interface TwinLimits {
  warning: number;
  shutdown: number;
}

/** `ops.systems[system].facilities[facility]` — needed only for the truck animation. */
export interface TwinTrucking {
  response_min: number;
  cycle_min: number;
}

export interface Twin3DProps {
  facility: Facility;
  readings: TwinReadings;
  /** `network.defaults.tank_limits_pct`. */
  limits: TwinLimits;
  /** Unix seconds of the displayed moment (the scrub position). */
  t: number;
  /** The facility's event to visualise (fault pulse, leak drips, degradation glow). Shown only while active at `t`. */
  event?: Event;
  /** Pump-failure plan; truck arrivals are animated at plan start + response_min (+ k × cycle_min). */
  plan?: Plan;
  trucking?: TwinTrucking;
  /** Readings strip over the scene. Default true. */
  hud?: boolean;
  className?: string;
}

export const CATEGORY_LABEL: Record<Category, string> = {
  pump_failure: "Pump failure",
  pipeline_leak: "Pipeline leak",
  pump_degradation: "Pump degradation",
};

/** Chip classes per category (tokens from src/app/tokens.css). */
export const CATEGORY_CHIP: Record<Category, string> = {
  pump_failure: "bg-cat-failure-soft text-cat-failure",
  pipeline_leak: "bg-cat-leak-soft text-cat-leak",
  pump_degradation: "bg-cat-degradation-soft text-cat-degradation",
};
