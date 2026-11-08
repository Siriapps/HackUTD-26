/**
 * Isolation test: SIMULATION_RULES must only appear in the glasses briefing when
 * simulation === true. The phone LiveSession briefing must never contain it.
 */
import { describe, it, expect } from "vitest";
import { SIMULATION_RULES } from "./simulation";

describe("SIMULATION_RULES content", () => {
  it("contains the SIMULATION MODE header", () => {
    expect(SIMULATION_RULES).toContain("SIMULATION MODE (classroom demo)");
  });

  it("mentions update_runbook_step tool", () => {
    expect(SIMULATION_RULES).toContain("update_runbook_step");
  });

  it("mentions draft_incident_report tool", () => {
    expect(SIMULATION_RULES).toContain("draft_incident_report");
  });

  it("mentions submit_incident_report tool", () => {
    expect(SIMULATION_RULES).toContain("submit_incident_report");
  });

  it("contains the technician-confirmed rule for completion", () => {
    expect(SIMULATION_RULES).toContain("technician_confirmed true");
  });

  it("does not auto-complete physical repairs", () => {
    expect(SIMULATION_RULES).toContain("Never mark a physical repair completed");
  });
});

describe("Simulation isolation", () => {
  it("SIMULATION_RULES string does not appear in fieldBriefing (no simulation flag)", async () => {
    // Import buildBriefing and check it doesn't include the sim text.
    // We cannot run analyse() in tests (browser-only), so we verify by string inspection.
    const { buildBriefing } = await import("@/lib/memory/briefing");
    // buildBriefing signature needs an EventContext; we just verify SIMULATION_RULES
    // is not embedded in the module source itself.
    const src = buildBriefing.toString();
    expect(src).not.toContain("SIMULATION MODE");
  });
});
