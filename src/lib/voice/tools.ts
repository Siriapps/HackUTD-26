// Mid-call tools for the phone agent. Same engine as iMessage replies and the ops console, so a decision made
// on the phone shows up everywhere (and the tech's thread is told).
import { composeOptions } from "@/lib/dispatch/alert";
import { decide } from "@/lib/dispatch/engine";
import { tellAlert } from "@/lib/dispatch/send";
import { serverAnalysis, serverEvent } from "@/lib/dispatch/server-data";
import { getAlert, update, allAlerts } from "@/lib/dispatch/store";
import { similar } from "@/lib/memory";
import { resolveAlert, spokenStatus } from "./brief";
import type { ToolName } from "./prompt";

export interface ToolBody {
  /** system__caller_id, filled by ElevenLabs. */
  caller?: string;
  event_id?: string;
  choice?: string;
  text?: string;
  note?: string;
  reason?: string;
}

export interface ToolDeps {
  /** Page the supervisor now (wire.escalateNow); injected so tests don't touch Photon. */
  escalate?: () => Promise<void>;
  tell?: typeof tellAlert;
}

const BY = "phone call";

export async function runTool(name: ToolName | string, body: ToolBody, deps: ToolDeps = {}): Promise<{ result: string }> {
  const tell = deps.tell ?? tellAlert;
  const a = resolveAlert(body.caller, body.event_id);
  if (typeof a === "string") return { result: a };
  const engine = { getEvent: serverEvent };

  switch (name) {
    case "get_status":
      return { result: await spokenStatus(a) };

    case "list_options": {
      const ev = (await serverAnalysis(a.folder, a.asOf)).events.find((e) => e.id === a.eventId);
      return { result: ev ? composeOptions(ev) : `${a.eventId} not found.` };
    }

    case "decide_plan": {
      const choice = (body.choice ?? "").trim() || "approve";
      const r = await decide(a.key, /^opt(ion)?\s*\d+$/i.test(choice) ? choice : choice.toLowerCase(), BY, engine);
      if (r.ok && r.changed) await tell(getAlert(a.key)!, `📞 On the call, ${a.eventId}: ${r.text.split("\n")[0]}`, `voice:${a.key}:${Date.now()}`);
      return { result: r.text };
    }

    case "log_observation": {
      const text = (body.text ?? "").trim();
      if (!text) return { result: "Nothing to log." };
      update(a.key, {}, { at: Date.now(), dir: "in", text, by: BY });
      await tell(getAlert(a.key)!, `📞 Field note on ${a.eventId}: ${text}`, `voice-obs:${a.key}:${Date.now()}`);
      return { result: `Logged on ${a.eventId}.` };
    }

    case "mark_fixed": {
      const r = await decide(a.key, "fixed", BY, engine);
      if (!r.ok) return { result: r.text };
      const cur = getAlert(a.key)!;
      const note = (body.note ?? "").trim();
      if (note && cur.resolution) update(a.key, { resolution: { ...cur.resolution, notes: [...cur.resolution.notes, note] }, noteUntil: undefined });
      await tell(getAlert(a.key)!, `📞 ${a.eventId} marked fixed on the call${note ? `: "${note}"` : ""}.`, `voice-fix:${a.key}:${Date.now()}`);
      return { result: `${a.eventId} closed${note ? " with your note" : ""}. The morning crew will see it.` };
    }

    case "page_supervisor": {
      const r = await decide(a.key, "help", BY, engine);
      if (body.reason) update(a.key, {}, { at: Date.now(), dir: "in", text: body.reason, intent: "help", by: BY });
      await (deps.escalate?.() ?? Promise.resolve());
      return { result: r.ok ? "Supervisor is being paged now by text. Stay clear of the equipment until they call." : r.text };
    }

    case "past_incidents": {
      const analysis = await serverAnalysis(a.folder, a.asOf);
      const ev = analysis.events.find((e) => e.id === a.eventId);
      if (!ev) return { result: "No record." };
      const tonight = allAlerts()
        .filter((x) => x.resolution?.notes.length)
        .map((x) => `${x.eventId} tonight: ${x.resolution!.notes.join(" / ")}`);
      const past = similar(ev, analysis).map((i) => `${i.summary} -> ${i.outcome}`);
      const all = [...tonight, ...past].slice(0, 4);
      return { result: all.length ? all.join("\n") : "No similar incidents on record." };
    }

    default:
      return { result: `Unknown tool ${name}.` };
  }
}
