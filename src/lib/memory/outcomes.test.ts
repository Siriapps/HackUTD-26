import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyse } from "../analyse";
import { datasetFromStrings } from "../data/load";
import type { Analysis, Category, Event, Plan } from "../data/types";
import { deriveOutcomes, type PumpFailureOutcome, type ResolutionOutcome } from "./outcomes";

const root = process.cwd();
const dir = path.join(root, "public", "data", "full_week");
const full = datasetFromStrings(
  "full_week",
  JSON.parse(readFileSync(path.join(dir, "network.json"), "utf8")),
  JSON.parse(readFileSync(path.join(dir, "ops.json"), "utf8")),
  readFileSync(path.join(dir, "telemetry.csv"), "utf8"),
);

interface KeyEvent {
  id: string;
  system: string;
  facility: string;
  asset: string;
  category: Category;
  onset_unix: number;
  end_unix: number | null;
  status: "ongoing" | "resolved";
  trips_at_unix?: number | null;
}
// The answer key is test-only input (fixtures/); app code never reads it.
const key: KeyEvent[] = JSON.parse(readFileSync(path.join(root, "fixtures", "full_week", "answer_key.json"), "utf8"));

const plan905: Plan = {
  recommended: { label: "1 truck, 1 trip", actions: [{ type: "dispatch_truck", facility_id: "S1_FACILITY_C", trucks: 1, trips_per_truck: 1 }], cost: 905, feasible: true, peak_level_pct: 88, trips_at_unix: null, curve: [] },
  alternatives: [],
  trucks_used: 1,
  horizon_end_unix: 0,
};

/** Hand-built Analysis: the key's events as the detector reports them once resolved, one with a plan attached. */
function fromKey(): Analysis {
  const events: Event[] = key.map((k) => ({
    id: k.id,
    system: k.system,
    facility: k.facility,
    asset: k.asset,
    category: k.category,
    onset_unix: k.onset_unix,
    end_unix: k.end_unix,
    status: k.status,
    confidence: 0.9,
    evidence: ["fixture"],
    actions: [],
    ...(k.id === "EVENT_9" ? { plan: plan905 } : {}),
  }));
  return { folder: full.folder, now: full.now, events, alerts: [], forecasts: [], fleet: {} };
}

const lostPerHr = (facility: string) => {
  const fac = full.network.systems.flatMap((s) => s.facilities).find((f) => f.id === facility)!;
  return fac.wells.reduce((s, w) => s + (w.oil_bpd * full.ops.prices.oil_per_bbl + w.gas_mcfd * full.ops.prices.gas_per_mcf) / 24, 0);
};

describe("deriveOutcomes(full_week)", () => {
  const outcomes = deriveOutcomes(full, fromKey());
  const byId = new Map(outcomes.map((o) => [o.event_id, o]));
  const failure = (id: string) => byId.get(id) as PumpFailureOutcome;

  it("yields one outcome per resolved event, in event order, with the right shape per category", () => {
    expect(outcomes.map((o) => o.event_id)).toEqual(key.map((k) => k.id));
    for (const o of outcomes) {
      expect(o.folder).toBe("full_week");
      if (o.category === "pump_failure") expect(typeof o.peak_level_pct).toBe("number");
      else expect(o.time_to_resolution_hours).toBeGreaterThan(0);
    }
  });

  it("EVENT_6: tank peaks ~76.7 % and never trips, so nothing was shut in and nothing was spent", () => {
    const o = failure("EVENT_6");
    expect(o.peak_level_pct).toBeCloseTo(76.7, 0);
    expect(o.tripped).toBe(false);
    expect(o.tripped_at_unix).toBeNull();
    expect(o.shut_in_hours).toBe(0);
    expect(o.truck_trips_observed).toBe(0);
    expect(o.actual_cost).toBe(0);
  });

  it("EVENT_11: trips at 13:25 (examples.md §3), wells shut in until the repair ends at 15:00", () => {
    const o = failure("EVENT_11");
    expect(o.tripped).toBe(true);
    expect(o.tripped_at_unix).toBe(1791465900);
    expect(o.peak_level_pct).toBeCloseTo(full.network.defaults.tank_limits_pct.shutdown, 1);
    expect(o.shut_in_hours).toBeCloseTo(95 / 60, 2);
    expect(o.actual_cost).toBeCloseTo(lostPerHr("S2_FACILITY_B") * (95 / 60), 0);
    expect(o.recommended_cost).toBeNull();
    expect(o.cost_delta).toBeNull();
  });

  it("every other failure tripped within one sample of the key's trips_at", () => {
    for (const k of key.filter((k) => k.category === "pump_failure" && k.trips_at_unix)) {
      const o = failure(k.id);
      expect(o.tripped, k.id).toBe(true);
      const lag = o.tripped_at_unix! - k.trips_at_unix!;
      expect(lag, `${k.id} tripped_at`).toBeGreaterThanOrEqual(0);
      expect(lag, `${k.id} tripped_at`).toBeLessThanOrEqual(300);
      expect(o.shut_in_hours).toBeCloseTo((k.end_unix! - o.tripped_at_unix!) / 3600, 2);
    }
  });

  it("EVENT_9: implied actual cost (90 min of lost production) against the recommended $905 plan", () => {
    const o = failure("EVENT_9");
    expect(o.recommended_cost).toBe(905);
    expect(o.recommended_label).toBe("1 truck, 1 trip");
    expect(o.actual_cost).toBeCloseTo(lostPerHr("S1_FACILITY_C") * 1.5, 0);
    expect(o.cost_delta).toBeCloseTo(o.actual_cost - 905, 2);
  });

  it("leaks and worn pumps record time to resolution", () => {
    expect((byId.get("EVENT_1") as ResolutionOutcome).time_to_resolution_hours).toBe(26);
    expect((byId.get("EVENT_5") as ResolutionOutcome).time_to_resolution_hours).toBeCloseTo(36.33, 2);
  });

  it("skips ongoing events", () => {
    const a = fromKey();
    a.events[0] = { ...a.events[0], status: "ongoing", end_unix: null };
    expect(deriveOutcomes(full, a).length).toBe(key.length - 1);
  });

  it("accepts analyse() output as is", () => {
    const a = analyse(full);
    expect(deriveOutcomes(full, a).length).toBe(a.events.filter((e) => e.status === "resolved").length);
  });
});
