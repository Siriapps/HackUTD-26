import { beforeEach, describe, expect, it, vi } from "vitest";
import { PhotonClient, photonConfig, safeKey } from "./client";
import { parseEvent } from "./events";
import { _reset, accept, emit, onEvent, recent } from "./inbox";
import { sign, verifyWebhook } from "./verify";

// Standard Webhooks reference vector (standard-webhooks spec test suite).
const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const ID = "msg_p5jXN8AQM9LWM0D4loKWxJek";
const TS = "1614265330";
const BODY = '{"test": 2432232314}';
const SIG = "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=";

describe("verifyWebhook", () => {
  it("matches the Standard Webhooks reference signature", () => {
    expect(`v1,${sign(SECRET, ID, TS, BODY)}`).toBe(SIG);
    expect(verifyWebhook(SECRET, { id: ID, timestamp: TS, signature: SIG }, BODY, Number(TS))).toEqual({ ok: true, id: ID });
  });
  it("accepts any matching entry in a multi-signature header", () => {
    const h = { id: ID, timestamp: TS, signature: `v1,bogus ${SIG}` };
    expect(verifyWebhook(SECRET, h, BODY, Number(TS)).ok).toBe(true);
  });
  it("rejects tampered body, stale timestamp and missing headers", () => {
    expect(verifyWebhook(SECRET, { id: ID, timestamp: TS, signature: SIG }, BODY + " ", Number(TS)).ok).toBe(false);
    expect(verifyWebhook(SECRET, { id: ID, timestamp: TS, signature: SIG }, BODY, Number(TS) + 301).ok).toBe(false);
    expect(verifyWebhook(SECRET, { id: null, timestamp: TS, signature: SIG }, BODY, Number(TS)).ok).toBe(false);
  });
});

const received = (text: unknown, content?: unknown) => ({
  id: "evt_1",
  type: "message.received",
  apiVersion: "2026-07-01",
  source: "imessage.photon",
  timestamp: "2026-11-08T03:00:00Z",
  data: {
    projectId: "pho_prj_x",
    object: {
      id: "pho_msg_1",
      platform: "imessage",
      status: "received",
      space: { id: "pho_spc_1" },
      sentBy: { id: "pho_usr_tech", handle: "+15550001111" },
      content: content ?? { type: "text", format: "plain", text },
    },
  },
});

describe("parseEvent", () => {
  it("extracts an inbound iMessage text", () => {
    expect(parseEvent(received("  YES  "))).toMatchObject({
      kind: "inbound_text",
      spaceId: "pho_spc_1",
      senderHandle: "+15550001111",
      text: "YES",
      messageId: "pho_msg_1",
    });
  });
  it("flattens group content", () => {
    const e = parseEvent(received(null, { type: "group", parts: [{ type: "text", text: "fixed" }, { type: "attachment" }] }));
    expect(e).toMatchObject({ kind: "inbound_text", text: "fixed" });
  });
  it("keeps photo-only messages with their attachment ids", () => {
    const e = parseEvent(received(null, { type: "group", parts: [{ type: "attachment", attachmentId: "pho_att_1" }] }));
    expect(e).toMatchObject({ kind: "inbound_text", text: "", attachments: ["pho_att_1"] });
  });
  it("maps typing indicators and unknown events to other", () => {
    expect(parseEvent(received(null, { type: "space.typing.update", typing: true })).kind).toBe("other");
    expect(parseEvent({ id: "e", type: "call.ended" })).toEqual({ kind: "other", eventId: "e", type: "call.ended" });
  });
  it("maps delivery outcomes", () => {
    const e = { id: "e2", type: "message.failed", data: { object: { id: "pho_msg_9", space: { id: "s" } } } };
    expect(parseEvent(e)).toMatchObject({ kind: "delivery", status: "failed", messageId: "pho_msg_9" });
  });
});

describe("inbox", () => {
  beforeEach(_reset);
  it("dedupes by webhook id and notifies listeners", async () => {
    const seen: string[] = [];
    onEvent((e) => void seen.push(e.eventId));
    const e = parseEvent(received("hi"));
    expect(accept("wh_1", e)).toBe(true);
    expect(accept("wh_1", e)).toBe(false);
    await emit(e);
    expect(recent()).toHaveLength(1);
    expect(seen).toEqual(["evt_1"]);
  });
});

describe("safeKey", () => {
  it("makes idempotency keys Photon-valid (printable ASCII, no spaces, ≤255)", () => {
    expect(safeKey("alert:f:EV-1:1 truck, 1 trip|905")).toBe("alert:f:EV-1:1_truck,_1_trip|905");
    expect(safeKey("x".repeat(300))).toHaveLength(255);
    expect(safeKey("é ")).toMatch(/^[\x21-\x7e]+$/);
  });
});

describe("PhotonClient", () => {
  it("is null without config", () => {
    expect(photonConfig({})).toBeNull();
  });
  it("resolves the agent line, opens a direct space and sends with idempotency key", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const reply = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.includes("/users?")) return reply({ items: [{ id: "pho_usr_me", kind: "agent" }, { id: "x", kind: "human" }] });
      if (url.endsWith("/users")) return reply({ id: "pho_usr_peer", kind: "human" });
      if (url.endsWith("/spaces")) return reply({ id: "pho_spc_9" });
      return reply({ id: "pho_msg_new" });
    });
    const c = new PhotonClient({ apiKey: "k", projectId: "pho_prj_p" }, fetchMock as unknown as typeof fetch);
    const msg = await c.textHandle("imessage", "+15550001111", "hello", "alert-EV-1");
    expect(msg.id).toBe("pho_msg_new");
    const send = calls.at(-1)!;
    expect(send.url).toBe("https://api.photon.codes/v1/projects/pho_prj_p/messages");
    const h = send.init.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer k");
    expect(h["Idempotency-Key"]).toBe("alert-EV-1");
    expect(JSON.parse(String(send.init.body))).toEqual({
      spaceId: "pho_spc_9",
      senderId: "pho_usr_me",
      content: { type: "text", format: "plain", text: "hello" },
    });
  });
  it("surfaces Photon error codes", async () => {
    const f = async () => new Response(JSON.stringify({ code: "NOT_AUTHENTICATED", status: 401 }), { status: 401 });
    const c = new PhotonClient({ apiKey: "k", projectId: "p", senderId: "s" }, f as unknown as typeof fetch);
    await expect(c.sendText("spc", "t", "k1")).rejects.toMatchObject({ status: 401, code: "NOT_AUTHENTICATED" });
  });
});
