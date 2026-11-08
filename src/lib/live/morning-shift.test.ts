/**
 * The Action Items card is read by the MORNING crew coming back to a thread. These scenarios are what they walk into;
 * the first items must be the critical first steps, in order, and must reflect what the night crew already did.
 */
import { describe, it, expect } from "vitest";
import { FIXTURES } from "@/lib/memory/fixture";
import { buildActionItems, type ThreadSummary } from "./action-items";
import { seedRunbook } from "./processor";

const pumpEvent = FIXTURES["FIX-PUMP"].event; // ongoing pump failure with a countdown and a priced plan
const rb = seedRunbook("pump_failure");
const NOW = Date.UTC(2026, 9, 10, 7, 0, 0); // 07:00 UTC, shift change
const base = { event: pumpEvent, runbook: rb, notes: [], report: null, nowMs: NOW };
const thread = (over: Partial<ThreadSummary>): ThreadSummary => ({ status: "awaiting", sentAt: NOW - 5 * 3_600_000, escalation: 0, ...over });
const first = (items: ReturnType<typeof buildActionItems>) => items.filter((i) => i.tone === "urgent");

describe("morning shift: critical first steps", () => {
  it("nobody decided overnight: 'no decision yet' is the first thing, with how long it has waited", () => {
    const items = buildActionItems({ ...base, thread: thread({ status: "awaiting" }) });
    expect(items[0].id).toBe("undecided");
    expect(items[0].detail).toContain("5 h");
    expect(items[0].detail).toContain(pumpEvent.plan!.recommended.label);
  });

  it("an event nobody was ever alerted about says so", () => {
    const items = buildActionItems({ ...base });
    expect(items[0].id).toBe("not-alerted");
  });

  it("an approved plan is NOT asked to be approved again; it asks to verify execution and shows who approved", () => {
    const t = thread({ status: "approved", choice: { label: "1 truck, 1 trip", cost: 905 }, decidedBy: "ops", decidedAt: NOW - 4 * 3_600_000 });
    const items = buildActionItems({ ...base, thread: t });
    expect(items.some((i) => i.id === "undecided")).toBe(false);
    expect(items.some((i) => /Approve or change/.test(i.detail ?? ""))).toBe(false);
    const verify = items.find((i) => i.id === "verify-plan")!;
    expect(verify.detail).toContain("ops");
    expect(verify.detail).toContain("$905");
  });

  it("an escalation outranks everything, including the countdown", () => {
    const items = buildActionItems({ ...base, thread: thread({ status: "escalated", escalation: 2 }) });
    expect(items[0].id).toBe("escalated");
    expect(items[0].detail).toMatch(/supervisor/);
    expect(first(items).map((i) => i.id)).toContain("undecided");
  });

  it("fixed overnight: first step is to verify the fix and read the technician's notes", () => {
    const t = thread({ status: "resolved", resolution: { at: NOW - 2 * 3_600_000, by: "tech", notes: ["reset the breaker, pump restarted"], photos: ["a"] } });
    const items = buildActionItems({ ...base, thread: t });
    const verify = items.find((i) => i.id === "verify-fix")!;
    expect(verify.detail).toContain("reset the breaker");
    expect(items.findIndex((i) => i.id === "verify-fix")).toBeLessThan(items.findIndex((i) => i.tone === "info"));
    expect(items.some((i) => i.id === "undecided")).toBe(false);
  });

  it("a call that ended with steps open says where to pick up", () => {
    const steps = rb.steps.map((s, i) => (i < 2 ? { ...s, status: "completed" as const } : s));
    const items = buildActionItems({ ...base, runbook: { ...rb, steps }, sessionLive: false, thread: thread({ status: "approved", choice: { label: "x", cost: 1 }, decidedBy: "ops", decidedAt: NOW }) });
    const resume = items.find((i) => i.id === "resume")!;
    expect(resume.title).toContain("step 3");
    expect(resume.detail).toContain("2 of 8");
  });

  it("includes a one-line overnight summary of what the night crew did", () => {
    const t = thread({ status: "approved", choice: { label: "1 truck, 1 trip", cost: 905 }, decidedBy: "ops", decidedAt: NOW - 4 * 3_600_000, escalation: 1 });
    const o = buildActionItems({ ...base, thread: t }).find((i) => i.id === "overnight")!;
    expect(o.detail).toMatch(/alerted 02:00/);
    expect(o.detail).toMatch(/approved 1 truck, 1 trip/);
    expect(o.detail).toMatch(/escalated/);
  });

  it("sensors show it resolved but the thread is open: verify and close", () => {
    const items = buildActionItems({ ...base, event: { ...pumpEvent, status: "resolved", hours_to_limit: null }, thread: thread({ status: "awaiting" }) });
    expect(items.some((i) => i.id === "sensors-resolved")).toBe(true);
    expect(items.some((i) => i.id === "countdown")).toBe(false);
  });
});
