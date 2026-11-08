import { describe, expect, it } from "vitest";
import { loadFixture } from "./fixtures";
import { seriesKey } from "./load";

describe("parseTelemetry", () => {
  it("builds aligned series for full_week", () => {
    const ds = loadFixture("full_week");
    expect(ds.ts.length).toBe(2016);
    expect(ds.ts[0]).toBe(1791158400);
    expect(ds.now).toBe(1791762900);
    // examples.md: S1_TANK_A level 30.42 at 2026-10-05T06:15Z (ts 1791180900)
    const i = ds.ts.indexOf(1791180900);
    expect(ds.series.get(seriesKey("S1_TANK_A", "level_pct"))![i]).toBeCloseTo(30.42, 2);
    expect(ds.series.get(seriesKey("S1_PUMP_A", "status"))![i]).toBe(0);
    expect(ds.network.defaults.tank_limits_pct.shutdown).toBe(92);
    expect(ds.ops.emergency_trucking.cost_per_trip).toBe(905);
  });
});
