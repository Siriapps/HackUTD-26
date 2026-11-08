// Turns a reply (iMessage from the tech or supervisor, or a button in the ops console / field app) into a
// decision on an open alert and the text we send back. Pure apart from injected deps, so every edge case is
// unit-tested without Photon or a dataset.
import type { Event, PlanOption } from "@/lib/data/types";
import { money } from "@/lib/format";
import { cheapestOf, composeOptions, composeStatus, countdownLine } from "./alert";
import { parseReply, type Reply } from "./replies";
import { getAlert, inSpace, openInSpace, update, allAlerts, type Choice, type OpenAlert } from "./store";

export interface EngineDeps {
  /** Fresh analysis for this alert's folder (at the alert's asOf): the event as it stands, plus dataset now. */
  getEvent(folder: string, eventId: string, asOf?: number): Promise<{ event: Event; now: number } | null>;
  /** Wall clock (ms) for decision timestamps. */
  clock?: () => number;
}

export interface InboundMsg {
  spaceId: string;
  text: string;
  attachments?: string[];
  /** Who is speaking on this thread ("tech", "supervisor"); defaults from the alert. */
  by?: string;
}

export interface EngineResult {
  reply: string;
  /** Alerts whose status changed (for cross-posting, memory sync, escalation hooks). */
  changed: OpenAlert[];
  parsed: Reply;
}

/** How long after FIXED a free-text reply or photo is taken as the resolution note. */
export const NOTE_WINDOW_MS = 30 * 60_000;

const HELP_TEXT = "Reply YES to approve · NO for options · TRUCKS / SHUT to switch · OPT n · OMW · ? status · FIXED when repaired · HELP";
const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16) + " UTC";

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
  // Several open: status/help/ack can fan out; decisions must name the event.
  if (r.intent === "status" || r.intent === "help" || r.intent === "ack") return open;
  const awaiting = open.filter((a) => a.status === "awaiting");
  if (awaiting.length === 1 && (r.intent === "approve" || r.intent === "reject")) return awaiting;
  return `You have ${open.length} open alerts: ${open.map((a) => `${a.eventId} (${a.status})`).join(", ")}. Start your reply with the event, e.g. "${open[0].eventId} YES".`;
}

const roleIn = (a: OpenAlert, spaceId: string) =>
  a.spaceId === spaceId ? "tech" : ((a.watchers ?? []).find((w) => w.spaceId === spaceId)?.role ?? "supervisor");

/**
 * Apply one parsed reply to one alert. Shared by iMessage replies, the ops console and the field app.
 * Returns the text to show the person who acted, and the updated alert when its state changed.
 */
export async function applyReply(
  a: OpenAlert,
  parsed: Reply,
  raw: string,
  by: string,
  deps: EngineDeps,
): Promise<{ text: string; changed?: OpenAlert }> {
  const now = deps.clock?.() ?? Date.now();
  const fresh = await deps.getEvent(a.folder, a.eventId, a.asOf);
  const log = { at: now, dir: "in" as const, text: raw, intent: parsed.intent, by };
  if (!fresh) return { text: `${a.eventId}: can't load the latest analysis; decision not recorded. Call the supervisor if urgent.` };
  const { event } = fresh;
  const done = (status: OpenAlert["status"], choice: Choice | undefined, text: string, extra: Partial<OpenAlert> = {}) => ({
    text,
    // Only choosing a plan records the decider; FIXED / HELP / NO keep who approved the plan.
    changed: update(a.key, { status, choice: choice ?? a.choice, ...(choice ? { decidedAt: now, decidedBy: by } : {}), ...extra }, log),
  });
  const note = (text: string) => {
    update(a.key, {}, log);
    return { text };
  };

  // Sensors already show it resolved: say so instead of dispatching trucks to a running pump.
  if (event.status === "resolved" && !["resolved", "status", "ack", "skip"].includes(parsed.intent)) {
    return done("resolved", undefined, `${a.eventId}: sensors show this already resolved; nothing dispatched.`);
  }

  switch (parsed.intent) {
    case "status":
      return note(composeStatus(event, fresh.now, a.choice ? `${a.status} by ${a.decidedBy ?? "?"}: ${a.choice.label}` : a.status));

    case "ack": {
      update(a.key, { ackAt: now }, log);
      const rec = event.plan?.recommended;
      const next =
        a.status === "approved" && a.choice
          ? `Plan approved: ${a.choice.label}. Reply FIXED when done.`
          : rec
            ? `Reply YES to approve ${rec.label} (${money(rec.cost)}), or FIXED when done.`
            : "Reply FIXED when cleared, or HELP.";
      return { text: `👍 Copy, ${a.eventId}. Escalation paused. ${countdownLine(event, fresh.now) ?? ""} ${next}`.replace(/\s+/g, " ").trim() };
    }

    case "approve": {
      if (a.status === "approved" && a.choice) return note(`${a.eventId} already approved by ${a.decidedBy ?? "someone"} at ${hhmm(a.decidedAt!)}: ${a.choice.label}.`);
      const rec = event.plan?.recommended;
      if (!rec) return done("approved", { label: `Inspect ${event.asset}`, cost: 0, actions: event.actions }, `✅ ${a.eventId} acknowledged. Inspect ${event.asset}; reply FIXED when cleared.`);
      // The plan may have been re-optimised since the alert went out: approve what's current and say if it moved.
      const moved = a.choice && a.choice.label !== rec.label ? ` (plan updated since alert, was ${a.choice.label})` : "";
      return done("approved", toChoice(rec), `✅ ${a.eventId} approved: ${rec.label}, ${money(rec.cost)}${moved}. ${countdownLine(event, fresh.now) ?? ""} Reply FIXED when the pump is back.`.trim());
    }

    case "reject":
      return done("rejected", undefined, composeOptions(event));

    case "trucks":
    case "shutin": {
      const o = cheapestOf(event, parsed.intent);
      if (!o) return note(`${a.eventId}: no ${parsed.intent === "trucks" ? "truck" : "shut-in"} option keeps the tank below shutdown. ${composeOptions(event)}`);
      return done("approved", toChoice(o), `✅ ${a.eventId} approved: ${o.label}, ${money(o.cost)}. Reply FIXED when the pump is back.`);
    }

    case "option": {
      const opts = optionsOf(event);
      const o = opts[(parsed.option ?? 0) - 1];
      if (!o) return note(`${a.eventId}: pick 1-${opts.length || 1}. ${composeOptions(event)}`);
      const warn = o.feasible ? "" : " ⚠️ tank still trips under this option.";
      return done("approved", toChoice(o), `✅ ${a.eventId} approved option ${parsed.option}: ${o.label}, ${money(o.cost)}.${warn}`);
    }

    case "resolved": {
      const stillDown = event.status === "ongoing" && event.category === "pump_failure";
      const caveat = stillDown ? " Sensors still show the pump down; we'll confirm when flow returns." : "";
      return done("resolved", undefined, `👍 ${a.eventId} marked fixed at ${hhmm(now)}.${caveat} What did you find? Reply with a note or photo for the morning crew, or SKIP.`, {
        resolution: { at: now, by, notes: [], photos: [] },
        noteUntil: now + NOTE_WINDOW_MS,
      });
    }

    case "help":
      return done("escalated", undefined, `🆘 ${a.eventId}: escalating to the supervisor now. Stay clear of the equipment; we'll call you.`);

    default:
      return note(`Didn't catch that. ${HELP_TEXT}`);
  }
}

/** Alert in this thread waiting for its post-FIXED note, if any. */
function pendingNote(spaceId: string, now: number) {
  return allAlerts().find((a) => inSpace(a, spaceId) && a.status === "resolved" && (a.noteUntil ?? 0) > now);
}

export async function handleInbound(msg: InboundMsg, deps: EngineDeps): Promise<EngineResult> {
  const now = deps.clock?.() ?? Date.now();
  const parsed = parseReply(msg.text);
  const changed: OpenAlert[] = [];
  const photos = msg.attachments ?? [];

  // Confirm loop: right after FIXED, free text or a photo is the resolution note, not a command.
  const pn = pendingNote(msg.spaceId, now);
  // "Replaced the seal, pump running again" is a description, not a second FIXED.
  if (pn && (photos.length || ["unknown", "skip", "resolved"].includes(parsed.intent))) {
    const by = msg.by ?? roleIn(pn, msg.spaceId);
    if (parsed.intent === "skip" && !photos.length) {
      const u = update(pn.key, { noteUntil: undefined }, { at: now, dir: "in", text: msg.text, intent: "skip", by });
      return { reply: `OK, ${pn.eventId} closed without a note. Thanks.`, changed: u ? [u] : [], parsed };
    }
    const r = pn.resolution ?? { at: now, by, notes: [], photos: [] };
    const resolution = { ...r, notes: msg.text ? [...r.notes, msg.text] : r.notes, photos: [...r.photos, ...photos] };
    const u = update(pn.key, { resolution }, { at: now, dir: "in", text: msg.text || `[${photos.length} photo${photos.length === 1 ? "" : "s"}]`, by });
    if (u) changed.push(u);
    const what = [msg.text && "note", photos.length && `${photos.length} photo${photos.length === 1 ? "" : "s"}`].filter(Boolean).join(" + ");
    return { reply: `📝 Saved ${what} to ${pn.eventId} for the morning crew. Send more anytime in the next ${Math.round(NOTE_WINDOW_MS / 60000)} min.`, changed, parsed };
  }

  if (!msg.text && photos.length) return { reply: "Got the photo, but there's no open job to attach it to.", changed, parsed };
  if (parsed.intent === "unknown") return { reply: `Didn't catch that. ${HELP_TEXT}`, changed, parsed };
  if (parsed.intent === "skip") return { reply: "Nothing to skip right now.", changed, parsed };
  if (parsed.intent === "ambiguous") {
    const c = parsed.candidates?.map((x) => x.toUpperCase()).join(" or ") ?? "";
    return { reply: `That reads as both ${c}. Reply with just one.`, changed, parsed };
  }

  const targets = pickTargets(openInSpace(msg.spaceId), parsed);
  if (typeof targets === "string") return { reply: targets, changed, parsed };

  const out: string[] = [];
  for (const a of targets) {
    const r = await applyReply(a, parsed, msg.text, msg.by ?? roleIn(a, msg.spaceId), deps);
    out.push(r.text);
    if (r.changed) changed.push(r.changed);
  }
  return { reply: out.join("\n\n"), changed, parsed };
}

/** Ops console / field app decision on one alert by key, e.g. decide(key, "approve", "ops"). */
export async function decide(key: string, command: string, by: string, deps: EngineDeps) {
  const a = getAlert(key);
  if (!a) return { ok: false as const, text: "No such alert." };
  const parsed = parseReply(command);
  if (parsed.intent === "unknown" || parsed.intent === "ambiguous") return { ok: false as const, text: `Unknown command "${command}".` };
  const r = await applyReply(a, parsed, command, by, deps);
  return { ok: true as const, ...r };
}
