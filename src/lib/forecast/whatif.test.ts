import { describe, expect, it } from "vitest";
import { analyse } from "../analyse";
import { loadFixture } from "../data/fixtures";
import { whatIf } from "./whatif";

describe("whatIf", () => {
  const ds = loadFixture("snapshot_2026-10-08T1200");
  const a = analyse(ds);

  it("baseline scenario reproduces the joint plan (three S2 failures, 2 trucks)", () => {
    const r = whatIf(ds, a, { system: "S2" });
    expect(r.facilities.length).toBe(3);
    expect(r.committed).toBe(2);
    const base = a.alerts.filter((e) => e.system === "S2" && e.category === "pump_failure").reduce((s, e) => s + e.plan!.recommended.cost, 0);
    expect(r.total_cost).toBeCloseTo(base, 0);
  });

  it("one truck fewer costs more, never less", () => {
    const base = whatIf(ds, a, { system: "S2" });
    const less = whatIf(ds, a, { system: "S2", fleetDelta: -1 });
    expect(less.fleet).toBe(base.fleet - 1);
    expect(less.committed).toBeLessThanOrEqual(1);
    expect(less.total_cost).toBeGreaterThanOrEqual(base.total_cost);
  });

  it("an extra failure in a healthy system is planned from its current tank reading", () => {
    const sys = ds.network.systems.find((s) => !a.alerts.some((e) => e.system === s.id && e.category === "pump_failure"))!;
    const fac = sys.facilities[0];
    const r = whatIf(ds, a, { system: sys.id, extraFailures: [fac.id] });
    expect(r.facilities).toEqual([expect.objectContaining({ facility: fac.id, hypothetical: true })]);
    expect(r.facilities[0].plan.recommended.curve.length).toBeGreaterThan(2);
    expect(r.total_cost).toBeGreaterThanOrEqual(0);
  });

  it("disposal site down fails every facility and uses at most the whole fleet", () => {
    const r = whatIf(ds, a, { system: "S4", disposalDown: true });
    expect(r.facilities.length).toBe(ds.network.systems.find((s) => s.id === "S4")!.facilities.length);
    expect(r.committed).toBeLessThanOrEqual(r.fleet);
  });
});
