import { createHmac } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { serverAnalysis } from "@/lib/dispatch/server-data";
import { _resetStore, getAlert, update, upsertAlert } from "@/lib/dispatch/store";
import type { Event } from "@/lib/data/types";
import { verifyElevenLabs } from "./auth";
import { briefFor, callerAlerts, phoneKey, resolveAlert } from "./brief";
import { SYSTEM_PROMPT, TOOL_DEFS } from "./prompt";
import { runTool } from "./tools";

const FOLDER = "snapshot_2026-10-10T0900";
const TECH = "+15550001111";
const SUP = "+15550002222";
let pumps: Event[];

beforeAll(async () => {
  const a = await serverAnalysis(FOLDER);
  pumps = a.alerts.filter((e) => e.category === "pump_failure" && e.plan);
});
beforeEach(_resetStore);

const open = (e: Event, handle = TECH) => upsertAlert({ eventId: e.id, folder: FOLDER, spaceId: `pho_spc_${e.id}`, handle, sentAt: Date.now() });
const deps = () => ({ tell: vi.fn(async () => 1), escalate: vi.fn(async () => {}) });

describe("prompt + tool defs", () => {
  it("prompt carries the briefing slot and the safety/escalation rules", () => {
    expect(SYSTEM_PROMPT).toContain("{{briefing}}");
    expect(SYSTEM_PROMPT).toMatch(/lockout\/tagout/);
    expect(SYSTEM_PROMPT).toMatch(/page_supervisor/);
    expect(SYSTEM_PROMPT).toMatch(/Never invent/);
    expect(TOOL_DEFS.map((t) => t.name)).toEqual(["get_status", "list_options", "decide_plan", "log_observation", "mark_fixed", "page_supervisor", "past_incidents"]);
  });
});

describe("caller resolution", () => {
  it("matches numbers by last 10 digits and finds tech vs paged supervisor", () => {
    expect(phoneKey("+1 (555) 000-1111")).toBe(phoneKey(TECH));
    const a = open(pumps[0]);
    update(a.key, { watchers: [{ spaceId: "pho_spc_sup", handle: SUP, role: "supervisor" }] });
    expect(callerAlerts("555-000-1111")).toMatchObject({ role: "tech", alerts: [expect.objectContaining({ eventId: pumps[0].id })] });
    expect(callerAlerts(SUP).role).toBe("supervisor");
    expect(callerAlerts("+19999999999").role).toBe("unknown");
  });
  it("needs an event id when the caller has several alerts; accepts 'ev 19'", () => {
    open(pumps[0]);
    open(pumps[1]);
    expect(resolveAlert(TECH)).toMatch(/Several open alerts/);
    const n = Number(pumps[1].id.slice(3));
    const r = resolveAlert(TECH, `ev ${n}`);
    expect(typeof r === "string" ? r : r.eventId).toBe(pumps[1].id);
  });
});

describe("briefFor", () => {
  it("briefs the caller on their alert with the field briefing facts and a spoken opener", async () => {
    open(pumps[0]);
    const b = await briefFor(TECH);
    expect(b.role).toBe("tech");
    expect(b.firstMessage).toContain(pumps[0].id);
    expect(b.firstMessage).toMatch(/to shutdown/);
    expect(b.firstMessage).toMatch(/is the area safe/);
    expect(b.briefing).toContain(`=== ${pumps[0].id} ===`);
    expect(b.briefing).toContain("DECIDED: nothing yet");
    expect(b.briefing).toMatch(/RUNBOOK/);
    expect(b.briefing).toContain(pumps[0].plan!.recommended.label);
    expect(b.briefing).not.toMatch(/camera/i);
  });
  it("with no alerts, gives the network picture", async () => {
    const b = await briefFor(TECH);
    expect(b.alerts).toHaveLength(0);
    expect(b.briefing).toMatch(/No alerts are dispatched/);
  });
});

describe("runTool", () => {
  it("decide_plan approves through the shared engine and tells the thread", async () => {
    const a = open(pumps[0]);
    const d = deps();
    const r = await runTool("decide_plan", { caller: TECH, choice: "approve" }, d);
    expect(r.result).toContain(`✅ ${pumps[0].id} approved`);
    expect(getAlert(a.key)).toMatchObject({ status: "approved", decidedBy: "phone call" });
    expect(d.tell).toHaveBeenCalledOnce();
  });
  it("mark_fixed closes with the spoken note; page_supervisor escalates", async () => {
    const a = open(pumps[0]);
    const d = deps();
    await runTool("mark_fixed", { caller: TECH, note: "impeller jammed with scale, cleared it" }, d);
    expect(getAlert(a.key)!.resolution!.notes).toEqual(["impeller jammed with scale, cleared it"]);
    const b = open(pumps[1]);
    const r = await runTool("page_supervisor", { caller: TECH, event_id: pumps[1].id, reason: "smells like H2S" }, d);
    expect(r.result).toMatch(/Supervisor is being paged/);
    expect(getAlert(b.key)!.status).toBe("escalated");
    expect(d.escalate).toHaveBeenCalledOnce();
  });
  it("status, options, observation and past incidents answer in plain text", async () => {
    const a = open(pumps[0]);
    const d = deps();
    expect((await runTool("get_status", { caller: TECH }, d)).result).toMatch(/shutdown in/);
    expect((await runTool("list_options", { caller: TECH }, d)).result).toMatch(/1\)/);
    expect((await runTool("log_observation", { caller: TECH, text: "seal weeping at the flange" }, d)).result).toMatch(/Logged/);
    expect(getAlert(a.key)!.log.at(-1)).toMatchObject({ text: "seal weeping at the flange", by: "phone call" });
    expect(typeof (await runTool("past_incidents", { caller: TECH }, d)).result).toBe("string");
  });
  it("unknown caller with nothing open gets a clear answer", async () => {
    expect((await runTool("get_status", { caller: TECH }, deps())).result).toBe("No open alerts right now.");
  });
});

describe("verifyElevenLabs", () => {
  const secret = "wsec_test";
  const body = '{"type":"post_call_transcription"}';
  const sign = (t: number, b = body) => `t=${t},v0=${createHmac("sha256", secret).update(`${t}.${b}`).digest("hex")}`;
  it("accepts a fresh valid signature and rejects tampering, staleness and junk", () => {
    const now = 1_800_000_000;
    expect(verifyElevenLabs(sign(now), body, secret, now)).toBe(true);
    expect(verifyElevenLabs(sign(now), body + " ", secret, now)).toBe(false);
    expect(verifyElevenLabs(sign(now - 31 * 60), body, secret, now)).toBe(false);
    expect(verifyElevenLabs("nonsense", body, secret, now)).toBe(false);
    expect(verifyElevenLabs(null, body, secret, now)).toBe(false);
  });
});
