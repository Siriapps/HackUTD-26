import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./lookup", () => ({
  findEventContext: vi.fn(async (id: string) =>
    id === "FIX-LEAK" ? { event: { id, category: "pipeline_leak" } } : id === "EV-0023" ? { event: { id, category: "pump_degradation" } } : null,
  ),
}));
vi.mock("@/lib/db/incidents", () => ({ loadLive: vi.fn(async () => null), saveLive: vi.fn() }));

import { ingest } from "./ingest";
import { applyEvent, pickCategory } from "./processor";
import { _reset, getLive, getLog, subscribe } from "./hub";
import type { LiveEvent } from "./types";

let n = 0;
function ev(type: LiveEvent["type"], payload: unknown, over: Partial<LiveEvent> = {}): LiveEvent {
  n += 1;
  return { id: `e${n}`, seq: n, sessionId: "s1", folder: "test", eventId: "FIX-LEAK", at: 1_000 + n, type, payload, ...over };
}

beforeEach(() => {
  _reset();
  n = 0;
});

describe("category resolution", () => {
  it("server lookup wins, then a string category, then category.category, then the fallback", () => {
    expect(pickCategory("pump_failure", "pipeline_leak")).toBe("pipeline_leak");
    expect(pickCategory("pipeline_leak")).toBe("pipeline_leak");
    // What the phone used to send: the whole event object.
    expect(pickCategory({ id: "FIX-LEAK", category: "pipeline_leak" })).toBe("pipeline_leak");
    expect(pickCategory({}, undefined)).toBe("general");
    expect(pickCategory("nonsense", "also-nonsense")).toBe("general");
  });
});

describe("live incident chain", () => {
  it("session.start seeds the runbook (fixture FIX-LEAK → pipeline_leak) and ships it over SSE", async () => {
    const seen: LiveEvent[] = [];
    subscribe("test", "FIX-LEAK", -1, (e) => seen.push(e));
    await ingest(ev("session.start", { simulation: true, category: { id: "FIX-LEAK" } }));
    const live = getLive("test", "FIX-LEAK");
    expect(live?.runbook.category).toBe("pipeline_leak");
    expect(live!.runbook.steps.length).toBeGreaterThan(0);
    const start = seen.find((e) => e.type === "session.start");
    expect((start?.payload as { runbook: { steps: unknown[] } }).runbook.steps.length).toBe(live!.runbook.steps.length);
  });

  it("completed without technician confirmation is shown as in_progress; confirmed completes with a note", async () => {
    await ingest(ev("session.start", { simulation: false, category: "" }));
    const seen: LiveEvent[] = [];
    subscribe("test", "FIX-LEAK", 999, (e) => seen.push(e));

    const r1 = await ingest(ev("runbook.update", { stepIndex: 0, status: "completed", technicianConfirmed: false }));
    expect(r1.result?.ok).toBe(true);
    expect(getLive("test", "FIX-LEAK")!.runbook.steps[0].status).toBe("in_progress");
    const wire = seen.find((e) => e.type === "runbook.update")!.payload as { status: string };
    expect(wire.status).toBe("in_progress"); // browsers must not see the raw "completed"

    await ingest(ev("runbook.update", { stepIndex: 0, status: "completed", technicianConfirmed: true }));
    const step = getLive("test", "FIX-LEAK")!.runbook.steps[0];
    expect(step.status).toBe("completed");
    expect(getLive("test", "FIX-LEAK")!.notes.some((x) => x.kind === "confirmation")).toBe(true);
  });

  it("blocked steps require and record the reason as a note, streamed as note.append", async () => {
    await ingest(ev("session.start", { simulation: true, category: "" }));
    const seen: LiveEvent[] = [];
    subscribe("test", "FIX-LEAK", 999, (e) => seen.push(e));

    const bad = await ingest(ev("runbook.update", { stepIndex: 2, status: "blocked", technicianConfirmed: false }));
    expect(bad.accepted).toBe(false);

    await ingest(ev("runbook.update", { stepIndex: 2, status: "blocked", technicianConfirmed: false, observation: "cannot walk the right-of-way in a classroom" }));
    expect(getLive("test", "FIX-LEAK")!.runbook.steps[2].status).toBe("blocked");
    const noteEvents = seen.filter((e) => e.type === "note.append");
    expect(noteEvents.length).toBe(1);
    expect((noteEvents[0].payload as { kind: string; text: string }).kind).toBe("blocked");
    expect((noteEvents[0].payload as { text: string }).text).toContain("right-of-way");
  });

  it("log_observation (note.append) persists in the snapshot; a bogus kind falls back to observation", async () => {
    await ingest(ev("session.start", { simulation: false, category: "" }));
    await ingest(ev("note.append", { kind: "observation", text: "wet flange" }));
    await ingest(ev("note.append", { kind: "weird", text: "gauge reads 40 psi" }));
    await ingest(ev("note.append", { kind: "escalation", text: "need a supervisor" }));
    const notes = getLive("test", "FIX-LEAK")!.notes;
    expect(notes.map((x) => x.kind)).toEqual(["observation", "observation", "escalation"]);
  });

  it("report.draft builds from accumulated notes/steps when lists are missing, then submit needs confirmation", async () => {
    await ingest(ev("session.start", { simulation: true, category: "" }));
    await ingest(ev("note.append", { kind: "observation", text: "wet flange" }));
    await ingest(ev("runbook.update", { stepIndex: 0, status: "completed", technicianConfirmed: true }));

    const seen: LiveEvent[] = [];
    subscribe("test", "FIX-LEAK", 999, (e) => seen.push(e));

    const d = await ingest(ev("report.draft", { summary: "Leak suspected at flange." }));
    expect(d.result?.ok).toBe(true);
    const live = getLive("test", "FIX-LEAK")!;
    expect(live.report?.status).toBe("draft");
    expect(live.report?.observations).toContain("wet flange");
    expect(live.report?.actions[0]).toContain("Completed");
    expect(live.report?.unresolved.length).toBeGreaterThan(0);
    expect(seen.some((e) => e.type === "report.draft")).toBe(true);

    const no = await ingest(ev("report.submit", { technician_confirmed: false }));
    expect(no.accepted).toBe(false);
    expect(getLive("test", "FIX-LEAK")!.report?.status).toBe("draft");

    const yes = await ingest(ev("report.submit", { technician_confirmed: true }));
    expect(yes.result?.ok).toBe(true);
    expect(getLive("test", "FIX-LEAK")!.report?.status).toBe("submitted");
  });

  it("list args may arrive as JSON text or newline text", async () => {
    await ingest(ev("session.start", { simulation: false, category: "" }));
    await ingest(ev("report.draft", { summary: "x", observations: '["a","b"]', actions: "one\ntwo", unresolved: [] }));
    const r = getLive("test", "FIX-LEAK")!.report!;
    expect(r.observations).toEqual(["a", "b"]);
    expect(r.actions).toEqual(["one", "two"]);
    expect(r.unresolved).toEqual([]);
  });

  it("an event id no dataset knows gets the general runbook (new ad-hoc incident)", async () => {
    await ingest(ev("session.start", { simulation: false, category: "" }, { eventId: "EV-9999" }));
    const live = getLive("test", "EV-9999")!;
    expect(live.runbook.category).toBe("general");
    expect(live.runbook.steps.length).toBeGreaterThan(3);
  });

  it("a known event id attaches to that event's own runbook", async () => {
    await ingest(ev("session.start", { simulation: false, category: "" }, { eventId: "EV-0023" }));
    expect(getLive("test", "EV-0023")!.runbook.category).toBe("pump_degradation");
  });

  it("an update with no session.start seen (server restart mid-call) still seeds a runbook", async () => {
    const r = await ingest(ev("runbook.update", { stepIndex: 1, status: "in_progress", technicianConfirmed: false }));
    expect(r.accepted).toBe(true);
    const live = getLive("test", "FIX-LEAK")!;
    expect(live.runbook.steps.length).toBeGreaterThan(1);
    expect(live.runbook.steps[1].status).toBe("in_progress");
  });

  it("duplicates are ignored; a new session starts a fresh log and runbook", async () => {
    const start = ev("session.start", { simulation: false, category: "" });
    await ingest(start);
    expect((await ingest(start)).duplicate).toBe(true);
    await ingest(ev("transcript.final", { role: "tech", text: "hello", turnId: "t" }));
    expect(getLog("test", "FIX-LEAK").some((e) => e.type === "transcript.final")).toBe(true);
    await ingest(ev("note.append", { kind: "observation", text: "old" }));

    await ingest(ev("session.start", { simulation: false, category: "" }, { sessionId: "s2" }));
    expect(getLog("test", "FIX-LEAK").some((e) => e.type === "transcript.final")).toBe(false);
    expect(getLive("test", "FIX-LEAK")!.notes).toEqual([]);
    expect(getLive("test", "FIX-LEAK")!.sessionId).toBe("s2");
  });
});

describe("applyEvent is pure", () => {
  it("does not mutate the previous snapshot", () => {
    const start = applyEvent(ev("session.start", { simulation: false, category: "pump_failure" }), null);
    const before = JSON.stringify(start.live);
    applyEvent(ev("note.append", { kind: "observation", text: "x" }), start.live);
    expect(JSON.stringify(start.live)).toBe(before);
  });
});
