import { describe, expect, it, beforeEach } from "vitest";
import { threadFromRecord, applyHydration, type DispatchRecord } from "./hydrate";
import { _resetStore, allAlerts, restoreMissing, type OpenAlert } from "./store";

const thread = (over: Partial<OpenAlert> = {}): OpenAlert => ({
  key: "snap|EV-0009",
  eventId: "EV-0009",
  folder: "snap",
  spaceId: "pho_spc_tech",
  handle: "+19725550123",
  sentAt: 1_700_000_000_000,
  status: "approved",
  choice: { label: "1 truck, 1 trip", cost: 905, actions: [] },
  decidedAt: 1_700_000_100_000,
  decidedBy: "tech",
  escalation: 0,
  watchers: [],
  log: [
    { at: 1_700_000_000_000, dir: "out", text: "PUMP DOWN EV-0009", by: "ops" },
    { at: 1_700_000_100_000, dir: "in", text: "YES", intent: "approve", by: "tech" },
  ],
  ...over,
});

describe("threadFromRecord", () => {
  it("prefers the stored dispatch snapshot so On-call restores space, plan and log after a restart", () => {
    const snap = thread();
    const a = threadFromRecord({
      id: "snap|EV-0009",
      dataset: "snap",
      event_id: "EV-0009",
      status: "ongoing",
      dispatch: snap,
      messages: [],
    });
    expect(a).toMatchObject({ key: "snap|EV-0009", spaceId: "pho_spc_tech", status: "approved", choice: { label: "1 truck, 1 trip" } });
    expect(a?.log).toHaveLength(2);
  });

  it("rebuilds a thread from messages when dispatch jsonb is missing (data written before the snapshot column)", () => {
    const rec: DispatchRecord = {
      id: "full_week|EV-0012",
      dataset: "full_week",
      event_id: "EV-0012",
      status: "ongoing",
      dispatch: null,
      messages: [
        {
          ts: 1_700_000_000_000,
          dir: "out",
          text: "PUMP DOWN EV-0012\n\n(not sent: no on-call handle)",
          recipient: "unsent",
          payload: { by: "ops", spaceId: "local" },
        },
        {
          ts: 1_700_000_050_000,
          dir: "in",
          text: "omw",
          recipient: "unsent",
          payload: { by: "tech", intent: "ack" },
        },
      ],
    };
    const a = threadFromRecord(rec);
    expect(a).toMatchObject({
      key: "full_week|EV-0012",
      folder: "full_week",
      eventId: "EV-0012",
      handle: "unsent",
      spaceId: "local",
      status: "awaiting",
      ackAt: 1_700_000_050_000,
    });
    expect(a?.log.map((l) => l.text)).toEqual([rec.messages[0].text, "omw"]);
  });

  it("ignores incident rows with no dispatch snapshot and no messages", () => {
    expect(
      threadFromRecord({
        id: "snap|EV-0001",
        dataset: "snap",
        event_id: "EV-0001",
        status: "ongoing",
        dispatch: null,
        messages: [],
      }),
    ).toBeNull();
  });
});

describe("applyHydration / restoreMissing", () => {
  beforeEach(_resetStore);

  it("fills an empty in-memory store from Tiger Data so GET /api/dispatch/state is not [] after npm run dev", () => {
    const loaded = [thread(), thread({ key: "snap|EV-0015", eventId: "EV-0015" })];
    expect(applyHydration([], loaded).map((a) => a.eventId)).toEqual(["EV-0009", "EV-0015"]);
    restoreMissing(loaded);
    expect(allAlerts().map((a) => a.eventId).sort()).toEqual(["EV-0009", "EV-0015"]);
  });

  it("does not overwrite a thread that already exists in this process", () => {
    restoreMissing([thread({ status: "awaiting", decidedBy: undefined })]);
    restoreMissing([thread({ status: "resolved", decidedBy: "ops" })]);
    expect(allAlerts()[0]).toMatchObject({ status: "awaiting" });
    expect(allAlerts()[0].decidedBy).toBeUndefined();
  });
});
