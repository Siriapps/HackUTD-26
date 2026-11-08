// Turns an inbound reply into a decision on an open alert and the text we send back.
// Pure apart from the injected deps, so every edge case is unit-tested without Photon or a dataset.
import type { Event, PlanOption } from "@/lib/data/types";
import { money } from "@/lib/format";
import { cheapestOf, composeOptions, composeStatus, countdownLine } from "./alert";
import { parseReply, type Reply } from "./replies";
import { openInSpace, update, type Choice, type OpenAlert } from "./store";

export interface EngineDeps {
  /** Fresh analysis for this alert's folder: the event as it stands now, plus dataset now. */
  getEvent(folder: string, eventId: string): Promise<{ event: Event; now: number } | null>;
  /** Wall clock (ms) for decision timestamps. */
  clock?: () => number;
}

export interface InboundMsg {
  spaceId: string;
  text: string;
}

export interface EngineResult {
  reply: string;
  /** Alerts whose status changed (for ticket / dashboard / escalation hooks). */
  changed: OpenAlert[];
  parsed: Reply;
}

const HELP_TEXT = "Reply YES to approve · NO for options · TRUCKS / SHUT to switch · OPT n · ? status · FIXED when repaired · HELP";

const toChoice = (o: PlanOption): Choice => ({ label: o.label, cost: o.cost, actions: o.actions });
const optionsOf = (e: Event) => (e.plan ? [e.plan.recommended, ...e.plan.alternatives].slice(0, 5) : []);

/** Which open alert(s) a reply is about; asks back when it can't tell. */
function pickTargets(open: OpenAlert[], r: Reply): OpenAlert[] | string {
  if (!open.length) return "No open alerts on this line right now. You'll get a text when something needs you.";
  if (r.eventRef) {
    const hit = open.filter((a) => a.eventId === r.eventRef);
    return hit.length ? hit : `${r.eventRef} isn't open for you. Open: ${open.map((a) => a.eventId).join(", ")}.`;
  }
  if (r.all) return open;
  if (open.length === 1) return open;
  // Several open: status/help can fan out; decisions must name the event.
  if (r.intent === "status" || r.intent === "help") return open;
  const awaiting = open.filter((a) => a.status === "awaiting");
  if (awaiting.length === 1 && (r.intent === "approve" || r.intent === "reject")) return awaiting;
  return `You have ${open.length} open alerts: ${open.map((a) => `${a.eventId} (${a.status})`).join(", ")}. Start your reply with the event, e.g. "${open[0].eventId} YES".`;
}

export async function handleInbound(msg: InboundMsg, deps: EngineDeps): Promise<EngineResult> {
  const now = deps.clock?.() ?? Date.now();
  const parsed = parseReply(msg.text);
  const changed: OpenAlert[] = [];
  const open = openInSpace(msg.spaceId);

  if (parsed.intent === "unknown") return { reply: `Didn't catch that. ${HELP_TEXT}`, changed, parsed };
  if (parsed.intent === "ambiguous") {
    const c = parsed.candidates?.map((x) => x.toUpperCase()).join(" or ") ?? "";
    return { reply: `That reads as both ${c}. Reply with just one.`, changed, parsed };
  }

  const targets = pickTargets(open, parsed);
  if (typeof targets === "string") return { reply: targets, changed, parsed };

  const out: string[] = [];
  for (const a of targets) {
    const fresh = await deps.getEvent(a.folder, a.eventId);
    const log = { at: now, dir: "in" as const, text: msg.text, intent: parsed.intent };
    if (!fresh) {
      out.push(`${a.eventId}: can't load the latest analysis; decision not recorded. Call the supervisor if urgent.`);
      continue;
    }
    const { event } = fresh;
    const done = (status: OpenAlert["status"], choice: Choice | undefined, text: string) => {
      const u = update(a.key, { status, choice: choice ?? a.choice, decidedAt: now }, log);
      if (u) changed.push(u);
      out.push(text);
    };

    // Sensors already show it resolved: say so instead of dispatching trucks to a running pump.
    if (event.status === "resolved" && parsed.intent !== "resolved" && parsed.intent !== "status") {
      done("resolved", undefined, `${a.eventId}: sensors show this already resolved; nothing dispatched.`);
      continue;
    }

    switch (parsed.intent) {
      case "status":
        update(a.key, {}, log);
        out.push(composeStatus(event, fresh.now, a.choice ? `${a.status}: ${a.choice.label}` : a.status));
        break;

      case "approve": {
        if (a.status === "approved" && a.choice) {
          out.push(`${a.eventId} already approved at ${new Date(a.decidedAt!).toISOString().slice(11, 16)} UTC: ${a.choice.label}.`);
          break;
        }
        const rec = event.plan?.recommended;
        if (!rec) {
          done("approved", { label: `Inspect ${event.asset}`, cost: 0, actions: event.actions }, `✅ ${a.eventId} acknowledged. Inspect ${event.asset}; reply FIXED when cleared.`);
          break;
        }
        // The plan may have been re-optimised since the alert went out: approve what's current and say if it moved.
        const moved = a.choice && a.choice.label !== rec.label ? ` (plan updated since alert, was ${a.choice.label})` : "";
        done("approved", toChoice(rec), `✅ ${a.eventId} approved: ${rec.label}, ${money(rec.cost)}${moved}. ${countdownLine(event, fresh.now) ?? ""} Reply FIXED when the pump is back.`.trim());
        break;
      }

      case "reject":
        done("rejected", undefined, composeOptions(event));
        break;

      case "trucks":
      case "shutin": {
        const o = cheapestOf(event, parsed.intent);
        if (!o) {
          const what = parsed.intent === "trucks" ? "truck" : "shut-in";
          out.push(`${a.eventId}: no ${what} option keeps the tank below shutdown. ${composeOptions(event)}`);
          update(a.key, {}, log);
          break;
        }
        done("approved", toChoice(o), `✅ ${a.eventId} approved: ${o.label}, ${money(o.cost)}. Reply FIXED when the pump is back.`);
        break;
      }

      case "option": {
        const opts = optionsOf(event);
        const o = opts[(parsed.option ?? 0) - 1];
        if (!o) {
          out.push(`${a.eventId}: pick 1-${opts.length || 1}. ${composeOptions(event)}`);
          update(a.key, {}, log);
          break;
        }
        const warn = o.feasible ? "" : " ⚠️ tank still trips under this option.";
        done("approved", toChoice(o), `✅ ${a.eventId} approved option ${parsed.option}: ${o.label}, ${money(o.cost)}.${warn}`);
        break;
      }

      case "resolved": {
        const stillDown = event.status === "ongoing" && event.category === "pump_failure";
        const caveat = stillDown ? " Sensors still show the pump down; we'll confirm when flow returns." : "";
        done("resolved", undefined, `👍 ${a.eventId} marked fixed at ${new Date(now).toISOString().slice(11, 16)} UTC. Add a note or photo here for the morning crew.${caveat}`);
        break;
      }

      case "help":
        done("escalated", undefined, `🆘 ${a.eventId}: escalating to the supervisor now. Stay clear of the equipment; we'll call you.`);
        break;
    }
  }
  return { reply: out.join("\n\n"), changed, parsed };
}
