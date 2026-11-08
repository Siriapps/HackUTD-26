import { describe, expect, it } from "vitest";
import { endMatches, loadFixture, loadKey, onsetMatches, observableStatus } from "../data/fixtures";
import { detectEvents, lastIndexLE } from "./events";

const full = loadFixture("full_week");

describe("detectEvents on full_week", () => {
  const events = detectEvents(full, full.ts.length - 1);
  const key = loadKey("full_week");

  it("finds all 23 events, nothing more, with the right category and asset", () => {
    expect(events.length).toBe(key.length);
    const got = events.map((e) => `${e.category}:${e.asset}:${e.onset_unix}`);
    for (const k of key) {
      const match = events.find((e) => e.category === k.category && e.asset === k.asset && onsetMatches(full, k, e.onset_unix));
      expect(match, `${k.id} ${k.category} ${k.asset} @${k.onset_unix} not found in ${got.join(", ")}`).toBeDefined();
    }
  });

  it("places onsets within 15 min of the key (or of the first observable sample) and ends sensibly", () => {
    for (const k of key) {
      const e = events.find((x) => x.category === k.category && x.asset === k.asset && onsetMatches(full, k, x.onset_unix))!;
      expect(e.status).toBe("resolved");
      expect(e.end_unix).not.toBeNull();
      // ends: failures exact; drifts within 15 min of the first sample at which the clearing is visible
      expect(endMatches(full, k, e.end_unix!), `${k.id} end ${e.end_unix} vs key ${k.end_unix}`).toBe(true);
      expect(e.system).toBe(k.system);
      expect(e.facility).toBe(k.facility);
    }
  });

  it("gives every event numeric evidence and a confidence in (0,1]", () => {
    for (const e of events) {
      expect(e.evidence.length).toBeGreaterThanOrEqual(2);
      expect(e.evidence.length).toBeLessThanOrEqual(4);
      for (const line of e.evidence) expect(line, `${e.id}: ${line}`).toMatch(/\d/);
      expect(e.confidence).toBeGreaterThan(0);
      expect(e.confidence).toBeLessThanOrEqual(1);
    }
    expect(events.map((e) => e.id)).toEqual(events.map((_, i) => `EV-${String(i + 1).padStart(4, "0")}`));
    for (let i = 1; i < events.length; i++) expect(events[i].onset_unix).toBeGreaterThanOrEqual(events[i - 1].onset_unix);
  });

  it("marks non-failures with a field_inspection action", () => {
    for (const e of events) if (e.category !== "pump_failure") expect(e.actions).toEqual([{ type: "field_inspection", asset_id: e.asset }]);
  });
});

describe.each(["snapshot_2026-10-08T1200", "snapshot_2026-10-09T0330", "snapshot_2026-10-10T0900"])("detectEvents on %s", (folder) => {
  const ds = loadFixture(folder);
  const key = loadKey(folder);
  const events = detectEvents(ds, ds.ts.length - 1);

  it("reproduces the key's event list and ongoing/resolved status", () => {
    expect(events.length).toBe(key.length);
    for (const k of key) {
      const e = events.find((x) => x.category === k.category && x.asset === k.asset && onsetMatches(ds, k, x.onset_unix));
      expect(e, `${k.id} ${k.category} ${k.asset}`).toBeDefined();
      // A drift that cleared while its pump was off is still ongoing as far as the data can tell.
      expect(e!.status, `${k.id} status`).toBe(observableStatus(ds, k));
      if (e!.status === "ongoing") expect(e!.end_unix).toBeNull();
    }
  });
});

describe("time travel", () => {
  it("sees only what had happened by the override and leaves the latest events ongoing", () => {
    const key = loadKey("full_week");
    const e13 = key.find((k) => k.id === "EVENT_13")!;
    const at = e13.onset_unix + 3600; // 11:00 on 10-08: E11, E12, E13 ongoing, E10 leak ongoing
    const events = detectEvents(full, lastIndexLE(full.ts, at));
    const ongoing = events.filter((e) => e.status === "ongoing").map((e) => e.asset).sort();
    expect(ongoing).toEqual(["S2_PUMP_A", "S2_PUMP_B", "S2_PUMP_C", "S3_PUMP_A", "S4_PUMP_C", "S5_PIPELINE_B"].sort());
    expect(events.every((e) => e.onset_unix <= at)).toBe(true);
  });
});
