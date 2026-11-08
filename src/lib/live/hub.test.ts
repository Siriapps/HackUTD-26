import { describe, it, expect, beforeEach } from "vitest";
import { publish, subscribe, getLog, getMaxSeq, _reset } from "./hub";
import type { LiveEvent } from "./types";

function makeEvent(overrides: Partial<LiveEvent> = {}): LiveEvent {
  return {
    id: `id-${Math.random()}`,
    seq: 1,
    sessionId: "sess-1",
    folder: "full_week",
    eventId: "EV-0001",
    at: Date.now(),
    type: "transcript.final",
    payload: { role: "tech", text: "hello", turnId: "t1" },
    ...overrides,
  };
}

beforeEach(() => _reset());

describe("hub.publish", () => {
  it("publishes a new event and returns true", () => {
    const e = makeEvent({ seq: 1 });
    expect(publish(e)).toBe(true);
  });

  it("ignores duplicate id and returns false", () => {
    const e = makeEvent({ id: "dup-id", seq: 1 });
    publish(e);
    expect(publish({ ...e, seq: 2 })).toBe(false);
  });

  it("stores finals in log and not partials", () => {
    const final = makeEvent({ seq: 1, type: "transcript.final" });
    const partial = makeEvent({ id: "p1", seq: 2, type: "transcript.partial", payload: { role: "tech", text: "ty", turnId: "t1" } });
    publish(final);
    publish(partial);
    const log = getLog("full_week", "EV-0001");
    expect(log.length).toBe(1);
    expect(log[0].type).toBe("transcript.final");
  });

  it("sorts out-of-order finals by seq", () => {
    publish(makeEvent({ id: "a", seq: 3, type: "transcript.final" }));
    publish(makeEvent({ id: "b", seq: 1, type: "transcript.final" }));
    publish(makeEvent({ id: "c", seq: 2, type: "note.append" }));
    const log = getLog("full_week", "EV-0001");
    expect(log.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("tracks maxSeq including partials", () => {
    publish(makeEvent({ id: "f", seq: 5, type: "transcript.final" }));
    publish(makeEvent({ id: "p", seq: 10, type: "transcript.partial", payload: { role: "tech", text: "t", turnId: "tx" } }));
    expect(getMaxSeq("full_week", "EV-0001")).toBe(10);
  });
});

describe("hub.subscribe", () => {
  it("replays log entries with seq > afterSeq immediately", () => {
    publish(makeEvent({ id: "a", seq: 1 }));
    publish(makeEvent({ id: "b", seq: 2 }));
    publish(makeEvent({ id: "c", seq: 3 }));

    const received: number[] = [];
    subscribe("full_week", "EV-0001", 1, (e) => received.push(e.seq));
    // Should replay seq 2 and 3 (afterSeq = 1)
    expect(received).toEqual([2, 3]);
  });

  it("delivers new events to subscriber after subscribe", () => {
    const received: LiveEvent[] = [];
    subscribe("full_week", "EV-0001", -1, (e) => received.push(e));

    publish(makeEvent({ id: "new1", seq: 5 }));
    expect(received.length).toBe(1);
    expect(received[0].seq).toBe(5);
  });

  it("unsubscribe stops delivery", () => {
    const received: LiveEvent[] = [];
    const unsub = subscribe("full_week", "EV-0001", -1, (e) => received.push(e));
    unsub();
    publish(makeEvent({ id: "after", seq: 1 }));
    expect(received.length).toBe(0);
  });

  it("partials not in afterSeq replay", () => {
    publish(makeEvent({ id: "p1", seq: 1, type: "transcript.partial", payload: { role: "tech", text: "t", turnId: "tx" } }));

    const received: LiveEvent[] = [];
    subscribe("full_week", "EV-0001", -1, (e) => received.push(e));
    // Replay only: partials not in log, so nothing replayed even with afterSeq=-1
    // (Subscriber will get future events including partials, but not replayed ones)
    // The log is empty; subscribe replays from log only.
    // After subscribe, we expect no immediate replay of that partial.
    expect(received.length).toBe(0);
  });

  it("isolates events across different eventIds", () => {
    publish(makeEvent({ id: "e1", seq: 1, eventId: "EV-0001" }));
    publish(makeEvent({ id: "e2", seq: 1, eventId: "EV-0002" }));

    const ev1: number[] = [];
    subscribe("full_week", "EV-0001", -1, (e) => ev1.push(e.seq));
    // Should only replay EV-0001 events
    expect(ev1.length).toBe(1);
  });
});
