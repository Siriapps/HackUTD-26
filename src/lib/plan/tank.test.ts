import { describe, expect, it } from "vitest";
import { latestShutIn } from "./shutin";
import { simulateTank, type TankSimInput } from "./tank";
import { arrivalsMin, busyUntilUnix, maxTrips } from "./trucks";

// README opening scene (EVENT_9): 800 bbl tank, half full, 1,800 bpd inflow, 6 h repair,
// truck response 75 min / cycle 230 min / 150 bbl, shutdown 92 %.
const start = 1_791_418_800;
const base: TankSimInput = {
  startUnix: start,
  horizonEndUnix: start + 6 * 3600,
  level0: 50,
  capacityBbl: 800,
  shutdownPct: 92,
  wells: [
    { id: "C1", bpd: 500 },
    { id: "C2", bpd: 700 },
    { id: "C3", bpd: 600 },
  ],
  truckBbl: 150,
};

describe("simulateTank", () => {
  it("trips at 4.48 h when nothing is done", () => {
    const r = simulateTank(base);
    expect(r.feasible).toBe(false);
    expect(r.peak).toBe(92);
    expect((r.tripsAtUnix! - start) / 3600).toBeCloseTo(4.48, 2);
    expect(r.curve[0]).toEqual({ t_unix: start, level_pct: 50 });
    expect(r.curve.at(-1)!.t_unix).toBe(base.horizonEndUnix);
    expect(r.curve.at(-1)!.level_pct).toBe(92);
  });

  it("one truck at +75 min keeps the peak at 87.5 %", () => {
    const r = simulateTank({ ...base, arrivalsMin: [75] });
    expect(r.feasible).toBe(true);
    expect(r.peak).toBeCloseTo(87.5, 1);
    expect(r.tripsAtUnix).toBeNull();
  });

  it("shutting in the 700 bpd well at +125 min just holds; +126 trips", () => {
    expect(simulateTank({ ...base, shutIn: { wells: ["C2"], afterMin: 125 } }).feasible).toBe(true);
    expect(simulateTank({ ...base, shutIn: { wells: ["C2"], afterMin: 125 } }).peak).toBeCloseTo(91.97, 1);
    expect(simulateTank({ ...base, shutIn: { wells: ["C2"], afterMin: 126 } }).feasible).toBe(false);
  });

  it("ignores arrivals at or after the horizon and caps removal at tank content", () => {
    expect(simulateTank({ ...base, arrivalsMin: [360] }).feasible).toBe(false);
    const r = simulateTank({ ...base, level0: 5, arrivalsMin: [0, 0, 0] });
    expect(r.curve[1].level_pct).toBe(0);
  });
});

describe("latestShutIn", () => {
  it("finds +125 for the 700 bpd well and null when even now is too late", () => {
    expect(latestShutIn(base, ["C2"])!.afterMin).toBe(125);
    expect(latestShutIn({ ...base, level0: 91.9 }, ["C1"])).toBeNull();
  });
});

describe("trucks", () => {
  it("arrivals, busy-until and trip caps follow the SPEC", () => {
    expect(arrivalsMin(75, 230, 3)).toEqual([75, 305, 535]);
    expect(busyUntilUnix(start, 75, 230, 1)).toBe(start + 305 * 60);
    expect(maxTrips(75, 230, 360)).toBe(2);
    expect(maxTrips(90, 230, 270)).toBe(1);
    expect(maxTrips(400, 230, 360)).toBe(0);
  });
});
