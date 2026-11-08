import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { analyse } from "@/lib/analyse";
import { loadFixture } from "@/lib/data/fixtures";
import type { Analysis, Event } from "@/lib/data/types";
import { handleInbound } from "./engine";
import { ackWindowMin, dueStep, elapsedView, ladder } from "./escalation";
import { countdownLine } from "./alert";
import type { Roster } from "./roster";
import { _resetStore, getAlert, update, upsertAlert } from "./store";
import { tick, type TickDeps } from "./ticker";

const FOLDER = "snapshot_2026-10-10T0900";
let A: Analysis;
let pump: Event;
let leak: Event;
beforeAll(() => {
  A = analyse(loadFixture(FOLDER));
  pump = A.alerts.find((e) => e.category === "pump_failure" && e.hours_to_limit)!;
  leak = A.alerts.find((e) => e.category !== "pump_failure")!;
});

const T0 = Date.UTC(2026, 10, 8, 3, 0);
const min = (m: number) => T0 + m * 60_000;
const open = (e: Event) => upsertAlert({ eventId: e.id, folder: FOLDER, spaceId: "spc_tech", handle: "+15550000001", sentAt: T0 });

describe("ladder", () => {
  it("derives the ack window from the event's own countdown, clamped", () => {
    const w = ackWindowMin(pump);
    expect(w).toBeCloseTo(Math.min(20, Math.max(5, pump.hours_to_limit!.p10 * 60 * 0.15)));
    expect(ladder(pump).map((s) => s.afterMin)).toEqual([w, 2 * w, 3 * w]);
    expect(ackWindowMin({ ...pump, hours_to_limit: { p10: 0.2, p50: 0.3, p90: 0.4 } })).toBe(5);
    expect(ackWindowMin({ ...pump, hours_to_limit: { p10: 30, p50: 31, p90: 32 } })).toBe(20);
    expect(ackWindowMin(leak)).toBe(30);
  });
});

describe("elapsedView", () => {
  it("counts the countdown down while the shutdown clock time stays fixed", () => {
    const before = countdownLine(pump, A.now)!;
    const after = countdownLine(...elapsedView(pump, A.now, 3600))!;
    const at = (s: string) => s.match(/at (\d\d:\d\d) UTC/)![1];
    expect(at(after)).toBe(at(before));
    const p50 = pump.hours_to_limit!.p50;
    expect(elapsedView(pump, A.now, 3600)[0].hours_to_limit!.p50).toBeCloseTo(Math.max(0, p50 - 1));
    expect(elapsedView(pump, A.now, 1e7)[0].hours_to_limit!.p50).toBe(0);
  });
});

describe("dueStep", () => {
  beforeEach(_resetStore);
  it("fires each rung only after its window, in order", () => {
    const a = open(pump);
    const w = ackWindowMin(pump);
    expect(dueStep(a, pump, min(w - 0.1))).toBeNull();
    expect(dueStep(a, pump, min(w))?.kind).toBe("reminder");
    const a1 = update(a.key, { escalation: 1 })!;
    expect(dueStep(a1, pump, min(w + 1))).toBeNull();
    expect(dueStep(a1, pump, min(2 * w))?.kind).toBe("supervisor");
    const a3 = update(a.key, { escalation: 3 })!;
    expect(dueStep(a3, pump, min(999))).toBeNull();
  });
  it("time scale compresses the ladder for demos", () => {
    const a = open(pump);
    const w = ackWindowMin(pump);
    expect(dueStep(a, pump, T0 + (w * 60_000) / 60, 60)?.kind).toBe("reminder");
  });
  it("stops when the tech replies, approves, or sensors resolve it", () => {
    const a = open(pump);
    expect(dueStep(update(a.key, {}, { at: T0, dir: "in", text: "?" })!, pump, min(999))).toBeNull();
    expect(dueStep({ ...a, log: [], status: "approved" }, pump, min(999))).toBeNull();
    expect(dueStep({ ...a, log: [] }, { ...pump, status: "resolved" }, min(999))).toBeNull();
  });
  it("HELP jumps straight to the supervisor, once", () => {
    const a = update(open(pump).key, { status: "escalated" }, { at: T0, dir: "in", text: "help", intent: "help" })!;
    expect(dueStep(a, pump, T0)?.kind).toBe("supervisor");
    expect(dueStep({ ...a, escalation: 2 }, pump, T0)).toBeNull();
  });
});

const roster = (sup: string[] = ["+15550000009"]): Roster => ({
  on_call: [],
  supervisor: sup.map((h) => ({ name: "Sam (supervisor)", role: "supervisor", channel: "imessage", handle: h })),
  morning_crew: [],
});

function fakeDeps(nowMs: number, opts: { failSpaces?: string[]; sup?: string[] } = {}) {
  const sent: { spaceId: string; text: string }[] = [];
  const deps: TickDeps = {
    getEvent: async (_f, id) => ({ event: A.events.find((e) => e.id === id)!, now: A.now }),
    roster: async () => roster(opts.sup),
    openSpace: async (h) => `spc_${h.slice(-4)}`,
    send: async (spaceId, text) => {
      if (opts.failSpaces?.includes(spaceId)) throw new Error("down");
      sent.push({ spaceId, text });
    },
    nowMs,
  };
  return { deps, sent };
}

describe("tick", () => {
  beforeEach(_resetStore);
  it("reminder → supervisor (joins the alert) → all hands", async () => {
    const a = open(pump);
    const w = ackWindowMin(pump);

    let f = fakeDeps(min(w));
    expect((await tick(f.deps)).map((x) => x.step)).toEqual(["reminder"]);
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]).toMatchObject({ spaceId: "spc_tech" });
    expect(f.sent[0].text).toMatch(/still needs you[\s\S]*shutdown in/);
    expect(f.sent[0].text).toMatch(/Supervisor gets paged in \d+ min/);

    f = fakeDeps(min(2 * w));
    await tick(f.deps);
    expect(f.sent.map((s) => s.spaceId)).toEqual(["spc_0009"]);
    expect(f.sent[0].text).toMatch(/ESCALATED[\s\S]*hasn't answered/);
    expect(getAlert(a.key)!.watchers).toEqual([expect.objectContaining({ spaceId: "spc_0009", role: "supervisor" })]);

    f = fakeDeps(min(3 * w));
    await tick(f.deps);
    expect(f.sent.map((s) => s.spaceId).sort()).toEqual(["spc_0009", "spc_tech"]);
    expect(f.sent[0].text).toContain("STILL UNACKNOWLEDGED");

    f = fakeDeps(min(99 * w));
    expect(await tick(f.deps)).toEqual([]);
  });

  it("a failed channel is reported and the ladder still advances", async () => {
    const a = open(pump);
    const f = fakeDeps(min(ackWindowMin(pump)), { failSpaces: ["spc_tech"] });
    expect(await tick(f.deps)).toEqual([expect.objectContaining({ step: "reminder", sentTo: [], failed: ["tech"] })]);
    expect(getAlert(a.key)!.escalation).toBe(1);
    expect(getAlert(a.key)!.log.at(-1)!.text).toContain("failed: tech");
  });

  it("no supervisor configured is surfaced, not silent", async () => {
    update(open(pump).key, { escalation: 1 });
    const f = fakeDeps(min(2 * ackWindowMin(pump)), { sup: [] });
    expect((await tick(f.deps))[0].failed).toContain("no supervisor in roster");
  });

  it("HELP pages the supervisor with the tech's words and tells the tech", async () => {
    const a = open(pump);
    update(a.key, { status: "escalated" }, { at: T0, dir: "in", text: "need help, valve stuck", intent: "help" });
    const f = fakeDeps(T0 + 1000);
    await tick(f.deps);
    const sup = f.sent.find((s) => s.spaceId === "spc_0009")!;
    expect(sup.text).toContain('asked for help: "need help, valve stuck"');
    expect(f.sent.find((s) => s.spaceId === "spc_tech")!.text).toContain("Supervisor paged");
  });

  it("the paged supervisor can approve from their own thread", async () => {
    const a = open(pump);
    update(a.key, { escalation: 2, watchers: [{ spaceId: "spc_sup", handle: "+15550000009", role: "supervisor" }] });
    const r = await handleInbound({ spaceId: "spc_sup", text: "yes" }, { getEvent: async () => ({ event: pump, now: A.now }) });
    expect(r.changed[0]).toMatchObject({ eventId: pump.id, status: "approved" });
  });
});
