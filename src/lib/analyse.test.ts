import { describe, expect, it } from "vitest";
import { analyse } from "./analyse";
import { loadFixture, loadKey, observableStatus } from "./data/fixtures";

const full = loadFixture("full_week");

describe("analyse(full_week)", () => {
  it("runs in under 5 s and returns every event resolved with no alerts", () => {
    const t0 = performance.now();
    const a = analyse(full);
    const ms = performance.now() - t0;
    console.log(`analyse(full_week) took ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(5000); // ~0.5 s warm locally; CI runners are slower and noisy
    expect(a.events.length).toBe(23);
    expect(a.alerts).toEqual([]);
    expect(a.now).toBe(full.now);
    expect(Object.keys(a.fleet).sort()).toEqual(full.network.systems.map((s) => s.id).sort());
    for (const s of full.network.systems) expect(a.fleet[s.id].size).toBe(full.ops.systems[s.id].emergency_fleet_size);
  });

  it("gives every pump failure a level at onset, lost revenue and the key's trips_at", () => {
    const a = analyse(full);
    const key = loadKey("full_week");
    for (const k of key.filter((k) => k.category === "pump_failure")) {
      const e = a.events.find((x) => x.category === "pump_failure" && x.onset_unix === k.onset_unix && x.asset === k.asset)!;
      expect(e.level_pct).toBeCloseTo(k.level_pct!, 0);
      expect(e.lost_revenue_per_hr).toBeGreaterThan(0);
      if (k.trips_at_unix == null) expect(e.trips_at_unix).toBeNull();
      else expect(Math.abs(e.trips_at_unix! - k.trips_at_unix), `${k.id} trips_at`).toBeLessThanOrEqual(5 * 60);
    }
  });
});

describe.each(["snapshot_2026-10-08T1200", "snapshot_2026-10-09T0330", "snapshot_2026-10-10T0900"])("analyse(%s) at its own now", (folder) => {
  const ds = loadFixture(folder);
  const key = loadKey(folder);
  const a = analyse(ds);

  it("matches hours_to_limit_final within 0.1 h and lost revenue per hour", () => {
    for (const k of key.filter((k) => k.status === "ongoing" && k.category === "pump_failure")) {
      const e = a.alerts.find((x) => x.asset === k.asset)!;
      expect(e, k.id).toBeDefined();
      expect(e.hours_to_limit!.p50, `${k.id} htl`).toBeCloseTo(k.hours_to_limit_final!, 1);
      expect(Math.abs(e.hours_to_limit!.p50 - k.hours_to_limit_final!)).toBeLessThanOrEqual(0.1);
      expect(e.hours_to_limit!.p10).toBeLessThanOrEqual(e.hours_to_limit!.p50);
      expect(e.hours_to_limit!.p90).toBeGreaterThanOrEqual(e.hours_to_limit!.p50);
      expect(e.lost_revenue_per_hr).toBeCloseTo(k.lost_revenue_per_hour!, 2);
      expect(Math.abs(e.level_pct! - k.level_final_pct!)).toBeLessThanOrEqual(0.3);
    }
  });

  it("orders alerts per SPEC: failures by countdown, then leaks and wear", () => {
    const failures = a.alerts.filter((e) => e.category === "pump_failure");
    const expected = key
      .filter((k) => k.order !== undefined)
      .sort((x, y) => x.order! - y.order!)
      .map((k) => k.asset);
    expect(failures.map((e) => e.asset)).toEqual(expected);
    const others = a.alerts.slice(failures.length);
    expect(others.every((e) => e.category !== "pump_failure")).toBe(true);
    expect(a.alerts.length).toBe(key.filter((k) => observableStatus(ds, k) === "ongoing").length);
  });
});

describe("time travel", () => {
  it("at an earlier now only uses the prefix and recomputes countdowns", () => {
    const key = loadKey("snapshot_2026-10-08T1200");
    const cut = loadFixture("snapshot_2026-10-08T1200");
    const a = analyse(full, cut.now);
    const b = analyse(cut);
    expect(a.alerts.map((e) => `${e.asset}:${e.hours_to_limit?.p50.toFixed(3)}`)).toEqual(b.alerts.map((e) => `${e.asset}:${e.hours_to_limit?.p50.toFixed(3)}`));
    expect(a.events.length).toBe(key.length);
  });
});
