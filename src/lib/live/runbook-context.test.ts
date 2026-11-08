import { describe, it, expect } from "vitest";
import { FIXTURES } from "@/lib/memory/fixture";
import { RUNBOOKS } from "@/lib/memory/incidents";
import { buildLiveRunbookContext } from "./runbook-context";
import { GENERAL_RUNBOOK, seedRunbook } from "./processor";
import { buildActionItems } from "./action-items";
import { serverEvent } from "@/lib/dispatch/server-data";

describe("deterministic, tailored runbook context", () => {
  it("lists exactly the server-seeded steps in order, for every fixture", () => {
    for (const [id, ctx] of Object.entries(FIXTURES)) {
      const text = buildLiveRunbookContext(ctx, id);
      const steps = seedRunbook(ctx.event.category).steps;
      let at = -1;
      steps.forEach((s, i) => {
        const needle = `${i + 1}) ${s.text}`;
        const pos = text.indexOf(needle);
        expect(pos, `${id} step ${i + 1}`).toBeGreaterThan(at);
        at = pos;
      });
      expect(steps.length).toBe(RUNBOOKS[ctx.event.category].steps.length);
    }
  });

  it("attaches facts from this event's own data (asset ids and readings)", () => {
    const pump = buildLiveRunbookContext(FIXTURES["FIX-PUMP"], "FIX-PUMP");
    expect(pump).toContain("S1_PUMP_A");
    expect(pump).toContain("S1_TANK_A");
    expect(pump).toMatch(/Facts: S1_PUMP_A reports status 2/);
    const leak = buildLiveRunbookContext(FIXTURES["FIX-LEAK"], "FIX-LEAK");
    expect(leak).toContain("S1_PIPELINE_C");
    expect(leak).not.toContain("S1_PUMP_A");
  });

  it("is deterministic and different per event", () => {
    const a1 = buildLiveRunbookContext(FIXTURES["FIX-PUMP"], "FIX-PUMP");
    expect(buildLiveRunbookContext(FIXTURES["FIX-PUMP"], "FIX-PUMP")).toBe(a1);
    expect(buildLiveRunbookContext(FIXTURES["FIX-LEAK"], "FIX-LEAK")).not.toBe(a1);
  });

  it("an unknown event gets the general runbook and an instruction not to invent anything", () => {
    const text = buildLiveRunbookContext(null, "EV-9999");
    GENERAL_RUNBOOK.steps.forEach((s, i) => expect(text).toContain(`${i + 1}) ${s}`));
    expect(text).toContain("EV-9999");
    expect(text).toMatch(/Never invent/);
  });
});

describe("Action Items for Operators", () => {
  const rb = seedRunbook("pump_failure");
  it("puts the clock and blocked steps first, then next steps, insight last", () => {
    const blocked = { ...rb, steps: rb.steps.map((s, i) => (i === 1 ? { ...s, status: "blocked" as const, observation: "no VFD access" } : s)) };
    const items = buildActionItems({ event: FIXTURES["FIX-PUMP"].event, runbook: blocked, notes: [{ at: 1, kind: "escalation", text: "need a mechanic" }], report: null });
    const tones = items.map((i) => i.tone);
    expect(tones[0]).toBe("urgent");
    expect(items.find((i) => i.id === "not-alerted")?.detail).toContain("Tank shutdown in about");
    expect(items.find((i) => i.id === "blocked-1")?.detail).toContain("no VFD access");
    expect(items.some((i) => i.title === "Technician asked for help")).toBe(true);
    expect(tones.lastIndexOf("urgent")).toBeLessThan(tones.indexOf("info"));
  });

  it("reflects report state and an event with no telemetry", () => {
    const draft = { status: "draft" as const, summary: "s", observations: [], actions: [], unresolved: ["valve not isolated"], technicianConfirmed: false };
    const items = buildActionItems({ runbook: rb, notes: [], report: draft });
    expect(items.some((i) => i.id === "report-draft")).toBe(true);
    expect(items.some((i) => i.detail === "valve not isolated")).toBe(true);
    expect(items.some((i) => i.id === "no-telemetry")).toBe(true);
    const sub = buildActionItems({ runbook: rb, notes: [], report: { ...draft, status: "submitted", technicianConfirmed: true } });
    expect(sub.some((i) => i.id === "report-submitted" && i.tone === "done")).toBe(true);
  });

  it("with no session yet it says so instead of rendering an empty card", () => {
    const items = buildActionItems({ runbook: null, notes: [], report: null });
    expect(items.some((i) => i.id === "no-session")).toBe(true);
  });
});

describe("serverEvent never throws a file error (the npm run dev ENOENT)", () => {
  it("resolves built-in fixtures without a dataset directory", async () => {
    const r = await serverEvent("fixture", "FIX-LEAK");
    expect(r?.event.id).toBe("FIX-LEAK");
  });
  it("returns null for a folder that does not exist", async () => {
    expect(await serverEvent("no_such_folder", "EV-0001")).toBeNull();
  });
});
