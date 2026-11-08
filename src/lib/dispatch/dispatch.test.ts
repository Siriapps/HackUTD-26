import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { analyse } from "@/lib/analyse";
import { loadFixture } from "@/lib/data/fixtures";
import type { Analysis, Event } from "@/lib/data/types";
import { cheapestOf, composeAlert, composeOptions } from "./alert";
import { NOTE_WINDOW_MS, decide, handleInbound, type EngineDeps } from "./engine";
import { composeHandoff } from "./handoff";
import { parseReply } from "./replies";
import { _resetStore, allAlerts, getAlert, upsertAlert } from "./store";

describe("parseReply", () => {
  const cases: [string, string, Record<string, unknown>?][] = [
    ["YES", "approve"],
    ["y", "approve"],
    ["ok send it", "approve"],
    ["👍", "approve"],
    ["go ahead", "approve"],
    ["no", "reject"],
    ["hold", "reject"],
    ["nope", "reject"],
    ["TRUCKS", "trucks"],
    ["yes trucks", "trucks"],
    ["no, shut in instead", "shutin"],
    ["shut em in", "shutin"],
    ["?", "status"],
    ["how long do i have", "status"],
    ["fixed", "resolved"],
    ["yes it's fixed", "resolved"],
    ["pump is back up", "resolved"],
    ["not fixed yet", "status"],
    ["no I need help", "help"],
    ["SOS", "help"],
    ["opt 2", "option", { option: 2 }],
    ["3", "option", { option: 3 }],
    ["EV-0019 yes", "approve", { eventRef: "EV-0019" }],
    ["ev 19 no", "reject", { eventRef: "EV-0019" }],
    ["EV-0003", "unknown", { eventRef: "EV-0003" }],
    ["yes all", "approve", { all: true }],
    ["yes no", "ambiguous"],
    ["trucks or shut in?", "ambiguous"],
    ["what's for dinner", "unknown"],
  ];
  it.each(cases)("%s → %s", (text, intent, extra) => {
    const r = parseReply(text);
    expect(r.intent).toBe(intent);
    if (extra) expect(r).toMatchObject(extra);
  });
});

// Real events from a snapshot: three S4 pump failures sharing a 2-truck fleet + a leak.
const FOLDER = "snapshot_2026-10-10T0900";
let A: Analysis;
const ev = (id: string) => A.events.find((e) => e.id === id)!;
let pumps: Event[];
let leak: Event;

beforeAll(() => {
  A = analyse(loadFixture(FOLDER));
  pumps = A.alerts.filter((e) => e.category === "pump_failure" && e.plan);
  leak = A.alerts.find((e) => e.category !== "pump_failure")!;
});

const deps = (overrides: Partial<Record<string, Event | null>> = {}): EngineDeps => ({
  getEvent: async (_f, id) => {
    const e = id in overrides ? overrides[id] : ev(id);
    return e ? { event: e, now: A.now } : null;
  },
  clock: () => Date.UTC(2026, 10, 8, 3, 0),
});
const SPACE = "pho_spc_tech";
const open = (e: Event, space = SPACE) => upsertAlert({ eventId: e.id, folder: FOLDER, spaceId: space, handle: "+15550001111", sentAt: Date.now() });

describe("composeAlert", () => {
  it("invites the tech to call the night engineer only when a voice number is configured", () => {
    const e = A.alerts[0];
    expect(composeAlert(e, { now: A.now, folder: FOLDER })).not.toContain("Or call");
    expect(composeAlert(e, { now: A.now, folder: FOLDER, voiceNumber: "+15550100" })).toContain("Or call +15550100 any time");
  });
  it("never prints undefined/NaN and carries countdown, plan cost, reply menu and deep link", () => {
    for (const e of A.alerts) {
      const t = composeAlert(e, { now: A.now, folder: FOLDER, baseUrl: "https://x.test", fleet: A.fleet[e.system] });
      expect(t).not.toMatch(/undefined|NaN|null/);
      expect(t).toContain(`https://x.test/field/${e.id}?folder=${FOLDER}`);
      if (e.plan) {
        expect(t).toMatch(/shutdown in \d+ h \d{2} min/);
        expect(t).toContain(`PLAN: ${e.plan.recommended.label}`);
        expect(t).toContain("Reply YES");
      }
    }
  });
  it("lists options with the recommendation first", () => {
    const t = composeOptions(pumps[0]);
    expect(t.split("\n")[1]).toContain("← recommended");
  });
});

describe("handleInbound", () => {
  beforeEach(_resetStore);

  it("YES approves the current recommended plan, and a repeat YES is idempotent", async () => {
    const e = pumps[0];
    const a = open(e);
    const r = await handleInbound({ spaceId: SPACE, text: "yes" }, deps());
    expect(r.reply).toContain(`✅ ${e.id} approved: ${e.plan!.recommended.label}`);
    expect(getAlert(a.key)).toMatchObject({ status: "approved", choice: { label: e.plan!.recommended.label } });
    const again = await handleInbound({ spaceId: SPACE, text: "YES" }, deps());
    expect(again.reply).toContain("already approved");
    expect(again.changed).toHaveLength(0);
  });

  it("NO returns the numbered options; OPT n then approves that option", async () => {
    const e = pumps[0];
    const a = open(e);
    const no = await handleInbound({ spaceId: SPACE, text: "no" }, deps());
    expect(no.reply).toContain("1)");
    expect(getAlert(a.key)!.status).toBe("rejected");
    const opt = await handleInbound({ spaceId: SPACE, text: "opt 2" }, deps());
    expect(opt.reply).toContain(`option 2: ${e.plan!.alternatives[0].label}`);
    expect(getAlert(a.key)!.choice!.label).toBe(e.plan!.alternatives[0].label);
  });

  it("OPT out of range asks again without changing state", async () => {
    open(pumps[0]);
    const r = await handleInbound({ spaceId: SPACE, text: "opt 9" }, deps());
    expect(r.reply).toMatch(/pick 1-\d/);
    expect(r.changed).toHaveLength(0);
  });

  it("TRUCKS / SHUT pick the cheapest feasible option of that kind", async () => {
    const e = pumps.find((p) => cheapestOf(p, "shutin"))!;
    open(e);
    const r = await handleInbound({ spaceId: SPACE, text: "shut in" }, deps());
    expect(r.reply).toContain(cheapestOf(e, "shutin")!.label);
  });

  it("with several open alerts, an unqualified YES asks which; a named one is applied", async () => {
    open(pumps[0]);
    open(pumps[1]);
    const r = await handleInbound({ spaceId: SPACE, text: "yes" }, deps());
    expect(r.reply).toMatch(/You have 2 open alerts/);
    expect(r.changed).toHaveLength(0);
    const named = await handleInbound({ spaceId: SPACE, text: `${pumps[1].id} yes` }, deps());
    expect(named.changed.map((c) => c.eventId)).toEqual([pumps[1].id]);
  });

  it("an unqualified YES goes to the only alert still awaiting a decision", async () => {
    open(pumps[0]);
    await handleInbound({ spaceId: SPACE, text: `${pumps[0].id} yes` }, deps());
    open(pumps[1]);
    const r = await handleInbound({ spaceId: SPACE, text: "yes" }, deps());
    expect(r.changed.map((c) => c.eventId)).toEqual([pumps[1].id]);
  });

  it("YES ALL approves every open alert; ? reports status for all", async () => {
    open(pumps[0]);
    open(pumps[1]);
    const all = await handleInbound({ spaceId: SPACE, text: "yes all" }, deps());
    expect(all.changed).toHaveLength(2);
    const st = await handleInbound({ spaceId: SPACE, text: "?" }, deps());
    expect(st.reply).toContain(pumps[0].id);
    expect(st.reply).toContain(pumps[1].id);
  });

  it("names an event that isn't open for this tech", async () => {
    open(pumps[0]);
    const r = await handleInbound({ spaceId: SPACE, text: "EV-9999 yes" }, deps());
    expect(r.reply).toContain("EV-9999 isn't open");
  });

  it("ambiguous and unknown replies change nothing", async () => {
    open(pumps[0]);
    expect((await handleInbound({ spaceId: SPACE, text: "yes no" }, deps())).reply).toMatch(/both APPROVE or REJECT/);
    expect((await handleInbound({ spaceId: SPACE, text: "lol" }, deps())).reply).toMatch(/Didn't catch that/);
  });

  it("does not dispatch for an event the sensors already show resolved", async () => {
    const e = pumps[0];
    open(e);
    const r = await handleInbound({ spaceId: SPACE, text: "yes" }, deps({ [e.id]: { ...e, status: "resolved" } }));
    expect(r.reply).toContain("already resolved");
    expect(r.changed[0].status).toBe("resolved");
  });

  it("FIXED closes the alert but flags when sensors still show the pump down; later texts see no open alerts", async () => {
    open(pumps[0]);
    const r = await handleInbound({ spaceId: SPACE, text: "fixed" }, deps());
    expect(r.reply).toContain("marked fixed");
    expect(r.reply).toContain("Sensors still show the pump down");
    expect((await handleInbound({ spaceId: SPACE, text: "yes" }, deps())).reply).toContain("No open alerts");
  });

  it("HELP escalates; a missing analysis never records a decision", async () => {
    const a = open(pumps[0]);
    expect((await handleInbound({ spaceId: SPACE, text: "help" }, deps())).changed[0].status).toBe("escalated");
    _resetStore();
    const b = open(pumps[0]);
    const r = await handleInbound({ spaceId: SPACE, text: "yes" }, deps({ [pumps[0].id]: null }));
    expect(r.reply).toContain("decision not recorded");
    expect(getAlert(b.key)!.status).toBe("awaiting");
    expect(a.key).toBe(b.key);
  });

  it("leak alerts: YES acknowledges an inspection", async () => {
    open(leak);
    const r = await handleInbound({ spaceId: SPACE, text: "yes" }, deps());
    expect(r.reply).toContain(`Inspect ${leak.asset}`);
  });

  it("other technicians' conversations are isolated", async () => {
    open(pumps[0], "pho_spc_other");
    expect((await handleInbound({ spaceId: SPACE, text: "yes" }, deps())).reply).toContain("No open alerts");
  });
});

describe("acknowledgements, confirm loop and ops decisions", () => {
  beforeEach(_resetStore);

  it.each([
    ["omw", "ack"],
    ["on my way", "ack"],
    ["arrived", "ack"],
    ["copy that", "ack"],
    ["10-4", "ack"],
    ["yes omw", "approve"],
    ["skip", "skip"],
    ["no notes", "skip"],
  ])("parses %s → %s", (text, intent) => {
    expect(parseReply(text).intent).toBe(intent);
  });

  it("OMW acknowledges without deciding and is logged as a reply (stops escalation)", async () => {
    const e = pumps[0];
    const a = open(e);
    const r = await handleInbound({ spaceId: SPACE, text: "omw" }, deps());
    expect(r.reply).toMatch(/Copy, .*Escalation paused.*Reply YES to approve/);
    const after = getAlert(a.key)!;
    expect(after.status).toBe("awaiting");
    expect(after.ackAt).toBeTruthy();
    expect(after.log.at(-1)).toMatchObject({ dir: "in", intent: "ack", by: "tech" });
  });

  it("FIXED asks for a note; the next text and photo are saved; SKIP closes the prompt", async () => {
    const e = pumps[0];
    const a = open(e);
    const fixed = await handleInbound({ spaceId: SPACE, text: "fixed" }, deps());
    expect(fixed.reply).toContain("Reply with a note or photo");
    expect(getAlert(a.key)!.resolution).toMatchObject({ by: "tech", notes: [], photos: [] });

    const note = await handleInbound({ spaceId: SPACE, text: "Replaced the seal, pump running again" }, deps());
    expect(note.reply).toContain("Saved note");
    const photo = await handleInbound({ spaceId: SPACE, text: "", attachments: ["pho_att_1"] }, deps());
    expect(photo.reply).toContain("Saved 1 photo");
    expect(getAlert(a.key)!.resolution).toMatchObject({ notes: ["Replaced the seal, pump running again"], photos: ["pho_att_1"] });

    const skip = await handleInbound({ spaceId: SPACE, text: "skip" }, deps());
    expect(skip.reply).toContain("closed without a note");
    expect((await handleInbound({ spaceId: SPACE, text: "more stuff" }, deps())).reply).toMatch(/Didn't catch that/);
  });

  it("the note window expires", async () => {
    open(pumps[0]);
    await handleInbound({ spaceId: SPACE, text: "fixed" }, deps());
    const late = { ...deps(), clock: () => Date.UTC(2026, 10, 8, 3, 0) + NOTE_WINDOW_MS + 1 };
    expect((await handleInbound({ spaceId: SPACE, text: "it was the seal" }, late)).reply).toMatch(/Didn't catch that/);
  });

  it("a photo with no open job says so", async () => {
    expect((await handleInbound({ spaceId: SPACE, text: "", attachments: ["pho_att_9"] }, deps())).reply).toContain("no open job");
  });

  it("ops console decide() uses the same engine and records who decided", async () => {
    const e = pumps[0];
    const a = open(e);
    const r = await decide(a.key, "approve", "ops", deps());
    expect(r.ok).toBe(true);
    expect(getAlert(a.key)).toMatchObject({ status: "approved", decidedBy: "ops" });
    const again = await handleInbound({ spaceId: SPACE, text: "yes" }, deps());
    expect(again.reply).toContain("already approved by ops");
    expect((await decide(a.key, "banana", "ops", deps())).ok).toBe(false);
    expect((await decide("nope", "approve", "ops", deps())).ok).toBe(false);
  });

  it("handoff log lists decisions, fixes with notes, and flags undecided alerts", async () => {
    const [p1, p2] = pumps;
    const a1 = open(p1);
    open(p2);
    await decide(a1.key, "approve", "ops", deps());
    await handleInbound({ spaceId: SPACE, text: `${p1.id} fixed` }, deps());
    await handleInbound({ spaceId: SPACE, text: "bad seal" }, deps());
    const text = composeHandoff("CONSOLE TEXT", allAlerts());
    expect(text.startsWith("CONSOLE TEXT")).toBe(true);
    expect(text).toContain("Overnight dispatch:");
    expect(text).toMatch(new RegExp(`${p1.id}: alerted .*by ops .*fixed .* by tech — "bad seal"`));
    expect(text).toMatch(new RegExp(`${p2.id}: alerted .*NO DECISION YET`));
    expect(composeHandoff("X", [])).toContain("No alerts were dispatched overnight.");
  });
});

describe("placeholder guard", () => {
  it("recognises fictional numbers and example domains only", async () => {
    const { isPlaceholder } = await import("./send");
    expect(isPlaceholder("+15555550100")).toBe(true);
    expect(isPlaceholder("daylead@example.com")).toBe(true);
    expect(isPlaceholder("+19725550123")).toBe(false);
    expect(isPlaceholder("ops@avon.energy")).toBe(false);
  });
});
