import { describe, expect, it } from "vitest";
import { analyse } from "../analyse";
import { loadFixture, loadKey } from "../data/fixtures";
import type { Action, Event, PlanOption } from "../data/types";

const full = loadFixture("full_week");
const a = analyse(full);
const key = loadKey("full_week");
const ev = (id: string): Event => {
  const k = key.find((k) => k.id === id)!;
  return a.events.find((e) => e.category === "pump_failure" && e.asset === k.asset && e.onset_unix === k.onset_unix)!;
};
const rec = (id: string) => ev(id).plan!.recommended;
const truck = (trucks: number, trips: number): Partial<Action> => ({ type: "dispatch_truck", trucks, trips_per_truck: trips });
const shut = (well: string, at: number): Partial<Action> => ({ type: "shut_in_wells", wells: [well], start_after_min: at });
const has = (o: PlanOption, part: Partial<Action>) => o.actions.some((x) => Object.entries(part).every(([k, v]) => JSON.stringify((x as never)[k]) === JSON.stringify(v)));
const near = (x: number, y: number, tol = 5) => expect(Math.abs(x - y), `${x} vs ${y}`).toBeLessThanOrEqual(tol);

describe("single-facility optimiser on full_week (plans at onset, whole fleet free)", () => {
  it("EVENT_6 never trips → no action, cost 0", () => {
    const o = rec("EVENT_6");
    expect(o.actions).toEqual([{ type: "none" }]);
    expect(o.cost).toBe(0);
    expect(o.feasible).toBe(true);
    expect(o.peak_level_pct).toBeCloseTo(76.7, 0);
  });

  it("EVENT_9: 1 truck 1 trip $905; alternatives hold $1,958 (S1_WELL_C2 at +125) and do-nothing $5,016", () => {
    const e = ev("EVENT_9");
    const o = e.plan!.recommended;
    expect(has(o, truck(1, 1))).toBe(true);
    near(o.cost, 905);
    const alts = e.plan!.alternatives;
    const s = alts.find((x) => has(x, shut("S1_WELL_C2", 125)))!;
    expect(s, alts.map((x) => x.label).join("\n")).toBeDefined();
    near(s.cost, 1958);
    const n = alts.find((x) => x.actions.length === 1 && x.actions[0].type === "none")!;
    near(n.cost, 5016);
    expect(n.feasible).toBe(false);
  });

  it.each([["EVENT_11"], ["EVENT_14"], ["EVENT_19"], ["EVENT_22"]])("%s: 1 truck, 1 trip, $905", (id) => {
    const o = rec(id);
    expect(has(o, truck(1, 1))).toBe(true);
    near(o.cost, 905);
  });

  it("EVENT_15: 1 truck 2 trips $1,810 (tie-break fewer trucks over 2 × 1)", () => {
    const o = rec("EVENT_15");
    expect(has(o, truck(1, 2))).toBe(true);
    near(o.cost, 1810);
  });

  it("EVENT_18: shut in S4_WELL_B1 at +306 min, $478, beats the $905 truck", () => {
    const o = rec("EVENT_18");
    expect(has(o, shut("S4_WELL_B1", 306))).toBe(true);
    near(o.cost, 478);
  });

  it("every option carries a curve over the horizon and feasible ones peak below shutdown", () => {
    const shutdown = full.network.defaults.tank_limits_pct.shutdown;
    for (const e of a.events.filter((e) => e.category === "pump_failure")) {
      const p = e.plan!;
      for (const o of [p.recommended, ...p.alternatives]) {
        expect(o.curve.length).toBeGreaterThanOrEqual(2);
        expect(o.curve[0].t_unix).toBeLessThanOrEqual(e.onset_unix + 1);
        expect(o.curve.at(-1)!.t_unix).toBe(p.horizon_end_unix);
        if (o.feasible) expect(o.peak_level_pct).toBeLessThan(shutdown);
      }
      expect(e.actions).toEqual(p.recommended.actions);
    }
  });
});

describe("snapshot_2026-10-09T0330: only 270 min of repair left", () => {
  it("EVENT_15 at now → 2 trucks × 1 trip $1,810 (a second trip would land after repair)", () => {
    const s = analyse(loadFixture("snapshot_2026-10-09T0330"));
    const e = s.alerts.find((x) => x.asset === "S4_PUMP_C")!;
    const o = e.plan!.recommended;
    expect(has(o, truck(2, 1))).toBe(true);
    near(o.cost, 1810);
    expect(s.fleet.S4.committed).toBe(2);
  });
});
