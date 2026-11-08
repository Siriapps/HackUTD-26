import { beforeEach, describe, expect, it } from "vitest";
import { recordResolution, similar } from "./index";
import { FIXTURES } from "./fixture";
import { feedbackCounts, htlBand, levelBand, recordFeedback } from "./incidents";

// Node has no localStorage; the memory module only needs getItem/setItem.
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  Object.assign(globalThis, {
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
  });
});

const pump = FIXTURES["FIX-PUMP"];
const leak = FIXTURES["FIX-LEAK"];

describe("incident memory", () => {
  it("bands levels and countdowns", () => {
    expect(levelBand(70.2)).toBe(70);
    expect(levelBand(undefined)).toBeNull();
    expect([htlBand(1.9), htlBand(2.6), htlBand(5), htlBand(9)]).toEqual(["<2h", "2-4h", "4-8h", "8h+"]);
  });

  it("retrieves same-category incidents, same system first, never the event itself", () => {
    const top = similar(pump.event, pump);
    expect(top).toHaveLength(3);
    expect(top.every((i) => i.category === "pump_failure")).toBe(true);
    expect(top.map((i) => i.id)).not.toContain("FIX-PUMP");
    expect(top[0].system).toBe("S1");
    expect(similar(leak.event, leak).every((i) => i.category === "pipeline_leak")).toBe(true);
  });

  it("learns: a recorded resolution replaces the outcome and lifts the incident", () => {
    const before = similar(pump.event, pump).findIndex((i) => i.id === "FIX-H2");
    recordResolution("FIX-H2", "Breaker reset held; pump restarted in 20 min");
    const after = similar(pump.event, pump);
    const h2 = after.find((i) => i.id === "FIX-H2")!;
    expect(h2.source).toBe("field");
    expect(h2.outcome).toContain("Breaker reset held");
    expect(after.indexOf(h2)).toBeLessThanOrEqual(before < 0 ? 2 : before);
    expect(after[0].id).toBe("FIX-H1"); // same system + same countdown band still wins
  });

  it("counts confirm/dismiss feedback per category", () => {
    recordFeedback("pump_failure", "confirm");
    recordFeedback("pump_failure", "confirm");
    recordFeedback("pipeline_leak", "dismiss");
    expect(feedbackCounts().pump_failure).toEqual({ confirm: 2, dismiss: 0 });
    expect(feedbackCounts().pipeline_leak.dismiss).toBe(1);
  });
});
