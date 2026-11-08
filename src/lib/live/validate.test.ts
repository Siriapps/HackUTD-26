import { describe, it, expect } from "vitest";
import {
  validateRunbookUpdate,
  validateDraftReport,
  validateReportSubmit,
  validateEnvelope,
} from "./validate";
import type { IncidentLive } from "./types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeLive(overrides: Partial<IncidentLive> = {}): IncidentLive {
  return {
    sessionId: "sess-1",
    startedAt: Date.now(),
    simulation: true,
    runbook: {
      category: "pump_failure",
      rule: "Lockout/tagout before any work.",
      steps: [
        { index: 0, text: "On arrival check breaker/fuse", status: "pending", technicianConfirmed: false },
        { index: 1, text: "Check the VFD fault code", status: "pending", technicianConfirmed: false },
        { index: 2, text: "Check motor temp", status: "pending", technicianConfirmed: false },
      ],
    },
    notes: [],
    report: null,
    maxSeq: 0,
    ...overrides,
  };
}

// ─── validateRunbookUpdate ────────────────────────────────────────────────────

describe("validateRunbookUpdate", () => {
  it("accepts in_progress without confirmation", () => {
    const live = makeLive();
    const result = validateRunbookUpdate(
      { stepIndex: 0, status: "in_progress", technicianConfirmed: false },
      live,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.applied.status).toBe("in_progress");
  });

  it("coerces completed-without-confirmation to in_progress and adds a note", () => {
    const live = makeLive();
    const result = validateRunbookUpdate(
      { stepIndex: 0, status: "completed", technicianConfirmed: false },
      live,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.applied.status).toBe("in_progress");
      expect(result.value.note).toMatch(/awaiting technician confirmation/i);
    }
  });

  it("accepts completed when technician_confirmed is true", () => {
    const live = makeLive();
    const result = validateRunbookUpdate(
      { stepIndex: 0, status: "completed", technicianConfirmed: true },
      live,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.applied.status).toBe("completed");
  });

  it("rejects blocked without observation", () => {
    const live = makeLive();
    const result = validateRunbookUpdate(
      { stepIndex: 1, status: "blocked", technicianConfirmed: false },
      live,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/observation/i);
  });

  it("accepts blocked with observation", () => {
    const live = makeLive();
    const result = validateRunbookUpdate(
      { stepIndex: 1, status: "blocked", technicianConfirmed: false, observation: "Cannot walk right-of-way in classroom" },
      live,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects out-of-range stepIndex (too low)", () => {
    const live = makeLive();
    const result = validateRunbookUpdate(
      { stepIndex: -1, status: "in_progress", technicianConfirmed: false },
      live,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/out of range/i);
  });

  it("rejects out-of-range stepIndex (too high)", () => {
    const live = makeLive();
    const result = validateRunbookUpdate(
      { stepIndex: 99, status: "in_progress", technicianConfirmed: false },
      live,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/out of range/i);
  });
});

// ─── validateDraftReport ─────────────────────────────────────────────────────

describe("validateDraftReport", () => {
  it("accepts a valid draft", () => {
    const result = validateDraftReport({
      summary: "Pump P1 found faulted; VFD fault code 42",
      observations: ["Breaker tripped", "VFD code 42"],
      actions: ["Reset attempted", "Mechanic called"],
      unresolved: ["Root cause of VFD fault"],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("draft");
      expect(result.value.technicianConfirmed).toBe(false);
    }
  });

  it("rejects empty summary", () => {
    const result = validateDraftReport({
      summary: "   ",
      observations: [],
      actions: [],
      unresolved: [],
    });
    expect(result.ok).toBe(false);
  });
});

// ─── validateReportSubmit ─────────────────────────────────────────────────────

describe("validateReportSubmit", () => {
  it("rejects submit with no report", () => {
    const live = makeLive();
    const result = validateReportSubmit(live, true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no incident report/i);
  });

  it("rejects submit without technician confirmation", () => {
    const live = makeLive({
      report: {
        status: "ready_for_review",
        summary: "s",
        observations: [],
        actions: [],
        unresolved: [],
        technicianConfirmed: false,
      },
    });
    const result = validateReportSubmit(live, false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/confirm/i);
  });

  it("accepts submit with ready report and confirmation", () => {
    const live = makeLive({
      report: {
        status: "ready_for_review",
        summary: "s",
        observations: [],
        actions: [],
        unresolved: [],
        technicianConfirmed: false,
      },
    });
    const result = validateReportSubmit(live, true);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("submitted");
      expect(result.value.technicianConfirmed).toBe(true);
    }
  });

  it("rejects re-submit of already-submitted report", () => {
    const live = makeLive({
      report: {
        status: "submitted",
        summary: "s",
        observations: [],
        actions: [],
        unresolved: [],
        technicianConfirmed: true,
      },
    });
    const result = validateReportSubmit(live, true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/already submitted/i);
  });
});

// ─── validateEnvelope ────────────────────────────────────────────────────────

describe("validateEnvelope", () => {
  const valid = {
    id: "uuid-1",
    seq: 1,
    sessionId: "sess-1",
    folder: "full_week",
    eventId: "EV-0001",
    at: 1234567890000,
    type: "transcript.final",
    payload: { role: "tech", text: "hello", turnId: "t1" },
  };

  it("accepts a valid envelope", () => {
    expect(validateEnvelope(valid).ok).toBe(true);
  });

  it("rejects non-object", () => {
    expect(validateEnvelope("bad").ok).toBe(false);
  });

  it("rejects missing id", () => {
    expect(validateEnvelope({ ...valid, id: undefined }).ok).toBe(false);
  });

  it("rejects missing seq", () => {
    expect(validateEnvelope({ ...valid, seq: "1" }).ok).toBe(false);
  });

  it("rejects missing sessionId", () => {
    expect(validateEnvelope({ ...valid, sessionId: "  " }).ok).toBe(false);
  });

  it("rejects missing eventId", () => {
    expect(validateEnvelope({ ...valid, eventId: "" }).ok).toBe(false);
  });

  it("rejects missing at", () => {
    expect(validateEnvelope({ ...valid, at: "now" }).ok).toBe(false);
  });
});
