import { describe, expect, it } from "vitest";
import { loadFixture } from "@/lib/data/load.test";
import type { Plan } from "@/lib/data/types";
import { findFacility, indexAt, planLevelAt, readingsAt, truckSchedule } from "./derive";

const ds = loadFixture("full_week");

describe("readingsAt", () => {
  it("samples the examples.md rows for S1_FACILITY_A", () => {
    const { facility } = findFacility(ds.network, "S1_FACILITY_A")!;
    const off = readingsAt(ds, facility, 1791180900);
    expect(off.level_pct).toBeCloseTo(30.42, 2);
    expect(off.pump_status).toBe(0);
    expect(off.flow_bpd).toBe(0);
    expect(off.inflow_bpd).toBeCloseTo(2390.6, 1);
    const on = readingsAt(ds, facility, 1791198000 + 120); // between samples → last sample at or before
    expect(on.pump_status).toBe(1);
    expect(on.flow_bpd).toBeCloseTo(3588.6, 1);
    expect(on.receive_flow_bpd).toBeCloseTo(3622.3, 1);
  });
  it("returns zeros before the first sample", () => {
    const { facility } = findFacility(ds.network, "S1_FACILITY_A")!;
    expect(indexAt(ds.ts, ds.ts[0] - 1)).toBe(-1);
    expect(readingsAt(ds, facility, ds.ts[0] - 1).level_pct).toBe(0);
  });
});

describe("truckSchedule", () => {
  it("places arrivals at start + response + k×cycle for every trip", () => {
    const start = 1791418800; // EVENT_9 onset; ops: response 75, cycle 230 → arrivals 01:35 and 05:25
    const plan: Plan = {
      recommended: {
        label: "1 truck, 2 trips",
        actions: [{ type: "dispatch_truck", facility_id: "S1_FACILITY_C", trucks: 1, trips_per_truck: 2 }],
        cost: 1810,
        feasible: true,
        peak_level_pct: 80,
        trips_at_unix: null,
        curve: [{ t_unix: start, level_pct: 50 }],
      },
      alternatives: [],
      trucks_used: 1,
      horizon_end_unix: start + 6 * 3600,
    };
    const trucking = ds.ops.systems.S1.facilities.S1_FACILITY_C;
    expect(truckSchedule(plan, undefined, trucking)).toEqual({ trucks: 1, arrivals: [start + 75 * 60, start + (75 + 230) * 60] });
    expect(truckSchedule(undefined, undefined, trucking).trucks).toBe(0);
  });
  it("interpolates the plan curve and is null outside it", () => {
    const plan = {
      recommended: {
        curve: [
          { t_unix: 0, level_pct: 50 },
          { t_unix: 600, level_pct: 60 },
          { t_unix: 1200, level_pct: 40 },
        ],
      },
    } as unknown as Plan;
    expect(planLevelAt(plan, 300)).toBe(55);
    expect(planLevelAt(plan, 900)).toBe(50);
    expect(planLevelAt(plan, 1200)).toBe(40);
    expect(planLevelAt(plan, -1)).toBeNull();
    expect(planLevelAt(plan, 1201)).toBeNull();
  });
});
