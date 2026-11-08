import { describe, expect, it } from "vitest";
import { analyse } from "../analyse";
import { loadFixture, loadKey } from "../data/fixtures";
import type { Action, PlanOption } from "../data/types";

const truck = (trucks: number, trips: number): Partial<Action> => ({ type: "dispatch_truck", trucks, trips_per_truck: trips });
const shut = (well: string, at: number): Partial<Action> => ({ type: "shut_in_wells", wells: [well], start_after_min: at });
const has = (o: PlanOption, part: Partial<Action>) => o.actions.some((x) => Object.entries(part).every(([k, v]) => JSON.stringify((x as never)[k]) === JSON.stringify(v)));
const near = (x: number, y: number, tol = 5) => expect(Math.abs(x - y), `${x} vs ${y}`).toBeLessThanOrEqual(tol);
// Shut-in starts depend on the anchored level (±0.01 pct at the data's noise floor), which moves the
// latest start by ±1 min and the cost by up to ~$10 against the generator's exact level.
const shutNear = (o: PlanOption, well: string, at: number) =>
  expect(o.actions.some((x) => x.type === "shut_in_wells" && x.wells[0] === well && Math.abs(x.start_after_min - at) <= 1), o.label).toBe(true);

describe("historical ledger on full_week (plans at onset, earlier plans followed)", () => {
  const a = analyse(loadFixture("full_week"));
  const key = loadKey("full_week");
  const rec = (id: string) => {
    const k = key.find((k) => k.id === id)!;
    return a.events.find((e) => e.category === "pump_failure" && e.asset === k.asset && e.onset_unix === k.onset_unix)!.plan!;
  };
  it("EVENT_12 finds 1 of 2 trucks free → $905", () => {
    const p = rec("EVENT_12");
    expect(has(p.recommended, truck(1, 1))).toBe(true);
    near(p.recommended.cost, 905);
    expect(p.trucks_used).toBe(1);
  });
  it("EVENT_13 finds 0 trucks → shut in S2_WELL_A1 at +189 min, $3,384", () => {
    const p = rec("EVENT_13");
    expect(has(p.recommended, shut("S2_WELL_A1", 189)), p.recommended.label).toBe(true);
    near(p.recommended.cost, 3384);
    expect(p.trucks_used).toBe(0);
    expect(p.alternatives.some((o) => o.actions.some((x) => x.type === "dispatch_truck"))).toBe(false);
  });
  it("EVENT_20 finds 1 truck → $905; EVENT_21 finds 0 → S4_WELL_A2 at +51 min, $2,414", () => {
    near(rec("EVENT_20").recommended.cost, 905);
    const p = rec("EVENT_21");
    shutNear(p.recommended, "S4_WELL_A2", 51);
    near(p.recommended.cost, 2414, 10);
  });
  it("EVENT_23 finds 1 truck → $905", () => {
    near(rec("EVENT_23").recommended.cost, 905);
  });
});

describe("joint fleet at now", () => {
  it("snapshot 10-08T1200: three S2 failures share 2 trucks → $905 / S2_WELL_C1 +46 $1,298 / $905", () => {
    const a = analyse(loadFixture("snapshot_2026-10-08T1200"));
    const p = (asset: string) => a.alerts.find((e) => e.asset === asset)!.plan!;
    near(p("S2_PUMP_B").recommended.cost, 905);
    near(p("S2_PUMP_A").recommended.cost, 905);
    const c = p("S2_PUMP_C").recommended;
    expect(has(c, shut("S2_WELL_C1", 46)), c.label).toBe(true);
    near(c.cost, 1298);
    expect(a.fleet.S2.committed).toBe(2);
    expect(p("S2_PUMP_C").alternatives.every((o) => !o.actions.some((x) => x.type === "dispatch_truck"))).toBe(true);
  });
  it("snapshot 10-10T0900: three S4 failures → E21 1 truck + S4_WELL_A2 +291 $975 / E19 $905 / E20 S4_WELL_D2 ~+108 $1,215", () => {
    const a = analyse(loadFixture("snapshot_2026-10-10T0900"));
    const p = (asset: string) => a.alerts.find((e) => e.asset === asset)!.plan!;
    const e21 = p("S4_PUMP_A").recommended;
    expect(has(e21, truck(1, 1)), e21.label).toBe(true);
    shutNear(e21, "S4_WELL_A2", 291);
    near(e21.cost, 975, 10);
    near(p("S4_PUMP_C").recommended.cost, 905);
    const e20 = p("S4_PUMP_D").recommended;
    shutNear(e20, "S4_WELL_D2", 108);
    near(e20.cost, 1215, 10);
    expect(a.fleet.S4.committed).toBe(2);
  });
});
