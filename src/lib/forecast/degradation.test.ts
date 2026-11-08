import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadFixture } from "@/lib/data/load.test";
import type { Event } from "@/lib/data/types";
import { FALLBACK_FAIL_RATIO, failureBand, fitRunningRatio, forecastDegradation, healthyBand } from "./degradation";

// answer_key.json is test-only input (never loaded by the app).
interface KeyEvent {
  id: string;
  system: string;
  facility: string;
  asset: string;
  category: Event["category"];
  onset_unix: number;
  end_unix: number;
}
const key: KeyEvent[] = JSON.parse(readFileSync(path.join(process.cwd(), "fixtures", "full_week", "answer_key.json"), "utf8"));
const ds = loadFixture("full_week");
const H = 3600;

const toEvent = (k: KeyEvent, now: number): Event => ({
  id: k.id,
  system: k.system,
  facility: k.facility,
  asset: k.asset,
  category: k.category,
  onset_unix: k.onset_unix,
  end_unix: now < k.end_unix ? null : k.end_unix,
  status: now < k.end_unix ? "ongoing" : "resolved",
  confidence: 1,
  evidence: [],
  actions: [],
});

const worn = key.filter((k) => k.category === "pump_degradation");
/** Degradations that ended in a failure of the same pump (answer key: pump_failure onset == degradation end). */
const failedLater = worn
  .map((k) => ({ k, fail: key.find((f) => f.category === "pump_failure" && f.asset === k.asset && f.onset_unix === k.end_unix) }))
  .filter((x): x is { k: KeyEvent; fail: KeyEvent } => !!x.fail);

describe("healthy baseline and failure band (derived from full_week itself)", () => {
  it("healthy running ratio sits at 1.000 with sub-percent noise", () => {
    const h = healthyBand(ds, ds.now);
    expect(h.median).toBeCloseTo(1.0, 2);
    expect(h.sigma).toBeGreaterThan(0.001);
    expect(h.sigma).toBeLessThan(0.01);
  });
  it("learns the pre-failure band from the three wear-related failures only", () => {
    const b = failureBand(ds, ds.now)!;
    expect(b.samples).toBe(failedLater.length); // S1_PUMP_C, S3_PUMP_A, S4_PUMP_C; S2_PUMP_A had recovered before it failed
    expect(b.ratio).toBeGreaterThan(0.84);
    expect(b.ratio).toBeLessThan(0.89);
  });
  it("has no band before the first wear-related failure, so the fallback fraction applies", () => {
    expect(failureBand(ds, failedLater[0].fail.onset_unix - 1)).toBeNull();
    expect(FALLBACK_FAIL_RATIO).toBeLessThan(1);
  });
});

describe("forecastDegradation on the five worn pumps", () => {
  it("fits a negative slope and a finite failure date 16 h into every degradation", () => {
    for (const k of worn) {
      const now = k.onset_unix + 16 * H;
      const [f] = forecastDegradation(ds, [toEvent(k, now)], now);
      expect(f, k.asset).toBeDefined();
      expect(f.pump_id).toBe(k.asset);
      expect(f.slope_per_hr, k.asset).toBeLessThan(-0.001);
      expect(f.predicted_fail_unix, k.asset).not.toBeNull();
      expect(f.predicted_fail_unix!, k.asset).toBeGreaterThan(now);
      expect(Number.isFinite(f.predicted_fail_unix!)).toBe(true);
      expect(f.cannot_drain_unix!, k.asset).toBeGreaterThan(f.predicted_fail_unix!); // inflow/max_flow < fail band
      expect(f.confidence).toBeGreaterThan(0.5);
    }
  });
  it("predicts the real failure time within 12 h at +16 h and within 6 h at +30 h", () => {
    for (const { k, fail } of failedLater) {
      for (const [ahead, tol] of [
        [16, 12],
        [30, 6],
      ]) {
        const now = k.onset_unix + ahead * H;
        const [f] = forecastDegradation(ds, [toEvent(k, now)], now);
        const errHours = Math.abs(f.predicted_fail_unix! - fail.onset_unix) / H;
        expect(errHours, `${k.asset} at +${ahead}h: ${errHours.toFixed(1)} h off`).toBeLessThan(tol);
      }
    }
  });
  it("returns nulls for a healthy pump and nothing for resolved or non-degradation events", () => {
    // S1_PUMP_A is healthy all week: pretend it was flagged and check the fit is flat.
    const now = ds.ts[0] + 40 * H;
    const fake: Event = {
      ...toEvent(worn[0], now),
      asset: "S1_PUMP_A",
      facility: "S1_FACILITY_A",
      system: "S1",
      onset_unix: ds.ts[0] + 24 * H,
      end_unix: null,
      status: "ongoing",
    };
    const [f] = forecastDegradation(ds, [fake], now);
    expect(f.predicted_fail_unix).toBeNull();
    expect(f.cannot_drain_unix).toBeNull();
    expect(f.confidence).toBe(0);
    expect(fitRunningRatio(ds, "S1_PUMP_A", 3600, ds.ts[0], now)!.r2).toBeLessThan(0.2);
    expect(forecastDegradation(ds, [toEvent(worn[0], ds.now)], ds.now)).toEqual([]); // resolved by then
    expect(forecastDegradation(ds, key.filter((k) => k.category !== "pump_degradation").map((k) => toEvent(k, ds.now)), ds.now)).toEqual([]);
  });
});
