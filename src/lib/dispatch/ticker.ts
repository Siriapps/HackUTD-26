// Fires due escalation steps. Injected deps keep it testable; wire.ts runs it on an interval.
import type { Event } from "@/lib/data/types";
import { composeEscalation, dueStep, ladder } from "./escalation";
import type { Roster } from "./roster";
import { allAlerts, update, type OpenAlert, type Watcher } from "./store";

export interface TickDeps {
  getEvent(folder: string, eventId: string): Promise<{ event: Event; now: number } | null>;
  roster(): Promise<Roster>;
  /** Open (or reuse) a direct conversation with a handle; returns its space id. */
  openSpace(handle: string): Promise<string>;
  send(spaceId: string, text: string, key: string): Promise<void>;
  nowMs: number;
  /** >1 compresses escalation timing for demos (DISPATCH_TIME_SCALE). */
  timeScale?: number;
}

export interface TickAction {
  eventId: string;
  step: string;
  sentTo: string[];
  failed: string[];
}

export async function tick(deps: TickDeps): Promise<TickAction[]> {
  const actions: TickAction[] = [];
  for (const a of allAlerts()) {
    const fresh = await deps.getEvent(a.folder, a.eventId).catch(() => null);
    if (!fresh) continue;
    const step = dueStep(a, fresh.event, deps.nowMs, deps.timeScale);
    if (!step) continue;

    const steps = ladder(fresh.event);
    const nextAfter = steps[step.level]?.afterMin;
    const nextInMin = nextAfter != null ? (nextAfter - step.afterMin) / (deps.timeScale ?? 1) : undefined;
    const text = composeEscalation(step, a, fresh.event, fresh.now, { nowMs: deps.nowMs, nextInMin, timeScale: deps.timeScale });

    const sentTo: string[] = [];
    const failed: string[] = [];
    let watchers: Watcher[] = a.watchers ?? [];
    const deliver = async (spaceId: string, label: string) => {
      try {
        await deps.send(spaceId, text, `esc:${a.key}:${step.level}:${spaceId}`);
        sentTo.push(label);
      } catch {
        failed.push(label);
      }
    };

    if (step.kind === "reminder") await deliver(a.spaceId, "tech");
    if (step.kind === "supervisor") {
      const sups = (await deps.roster()).supervisor;
      for (const p of sups) {
        try {
          const spaceId = await deps.openSpace(p.handle);
          if (!watchers.some((w) => w.spaceId === spaceId)) watchers = [...watchers, { spaceId, handle: p.handle, role: p.role, name: p.name }];
          await deliver(spaceId, p.name || p.role);
        } catch {
          failed.push(p.name || p.role);
        }
      }
      if (!sups.length) failed.push("no supervisor in roster");
      // Tell the tech help is coming.
      if (a.status === "escalated") await deps.send(a.spaceId, `Supervisor paged for ${a.eventId}.`, `esc-ack:${a.key}`).catch(() => undefined);
    }
    if (step.kind === "all_hands") {
      await deliver(a.spaceId, "tech");
      for (const w of watchers) await deliver(w.spaceId, w.name || w.role);
    }

    // Advance even on delivery failure so a dead channel can't stall the ladder.
    update(a.key, { escalation: step.level, watchers }, { at: deps.nowMs, dir: "out", text: `[escalation ${step.kind} → ${sentTo.join(", ") || "nobody"}${failed.length ? `; failed: ${failed.join(", ")}` : ""}] ${text}` });
    actions.push({ eventId: a.eventId, step: step.kind, sentTo, failed });
  }
  return actions;
}

/** Text for the other people on an alert when someone acts on it. */
export function crossPost(a: OpenAlert, who: string, reply: string) {
  return `👤 ${who} on ${a.eventId}: ${reply.split("\n")[0]}`;
}
