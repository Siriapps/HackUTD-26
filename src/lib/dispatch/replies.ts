// Parse a technician's free-text reply (iMessage/SMS/voice transcript) into one intent.
// Deliberately forgiving: night-shift thumbs type "y", "👍", "ok send it", "shut em in", "EV-0003 yes".

export type Intent =
  | "approve"
  | "reject"
  | "trucks"
  | "shutin"
  | "option"
  | "resolved"
  | "help"
  | "status"
  | "ambiguous"
  | "unknown";

export interface Reply {
  intent: Intent;
  /** Event the reply names explicitly ("EV-0003", "ev 3"), normalised to "EV-0003". */
  eventRef?: string;
  /** "ALL" to apply to every open alert in the conversation. */
  all?: boolean;
  /** 1-based option number for intent "option". */
  option?: number;
  /** For ambiguous replies: which intents collided. */
  candidates?: Intent[];
  raw: string;
}

const RULES: [Intent, RegExp][] = [
  ["help", /\b(help|sos|need (a )?hand|need backup|can'?t|cannot|unsafe|hurt|injur\w*|emergency)\b|🆘/i],
  ["resolved", /\b(fixed|repaired|resolved|done|back (up|online|running)|pump(ing)? (is )?(up|running)|all good)\b|✅/i],
  ["status", /^\s*\?+\s*$|\b(status|eta|how long|time left|countdown|level|update)\b/i],
  ["shutin", /\bshut[\s-]?(it|them|em|'em)?[\s-]?in\b|\bshutin\b|\bshut\b|\bshut[\s-]?down wells?\b/i],
  ["trucks", /\btrucks?\b|\bhaul\b|\bvac(uum)?\b/i],
  ["approve", /^\s*(y|ya|yes+|yep|yeah|yup|ok(ay)?|k|go|approve[d]?|confirm(ed)?|do it|send( it)?|dispatch|sure|affirmative|roger|copy)\b|👍|\b(yes|approve|go ahead)\b/i],
  ["reject", /^\s*(n|no+|nope|nah|reject(ed)?|deny|denied|hold|wait|stop|cancel|negative)\b|👎|\b(don'?t|do not|no)\b/i],
];

const EVENT_RE = /\b(?:EV|event)[\s#-]*0*(\d{1,5})\b/i;
const OPTION_RE = /^\s*(?:opt(?:ion)?|#)\s*(\d{1,2})\b|^\s*(\d{1,2})\s*$/i;

export function eventId(n: number | string) {
  return `EV-${String(n).padStart(4, "0")}`;
}

export function parseReply(raw: string): Reply {
  const text = raw.trim();
  const ev = text.match(EVENT_RE);
  const eventRef = ev ? eventId(ev[1]) : undefined;
  const all = /\ball\b/i.test(text) || undefined;
  // Strip the event ref so "EV-0003" never reads as option 3 or as a status word.
  const body = ev ? text.replace(ev[0], " ").trim() : text;

  const opt = body.match(OPTION_RE);
  if (opt) return { intent: "option", option: Number(opt[1] ?? opt[2]), eventRef, all, raw };

  let hits = RULES.filter(([, re]) => re.test(body)).map(([i]) => i);
  // "not fixed yet", "isn't done", "still not back up" are progress reports, not resolutions.
  if (/\b(not|isn'?t|ain'?t|never|still)\s+(yet\s+)?(fixed|repaired|resolved|done|back)\b/i.test(body)) {
    hits = hits.filter((h) => h !== "resolved" && h !== "reject");
    if (!hits.length) hits = ["status"];
  }
  // "help" and "resolved" override yes/no noise ("yes fixed", "no I need help").
  for (const strong of ["help", "resolved"] as const) if (hits.includes(strong)) return { intent: strong, eventRef, all, raw };
  // A choice of plan implies approval of that choice: "yes trucks" → trucks, "no, shut in instead" → shutin.
  const choice = hits.filter((h) => h === "trucks" || h === "shutin");
  if (choice.length === 1) return { intent: choice[0], eventRef, all, raw };
  if (choice.length > 1) return { intent: "ambiguous", candidates: choice, eventRef, all, raw };

  const yn = hits.filter((h) => h === "approve" || h === "reject");
  if (yn.length > 1) return { intent: "ambiguous", candidates: yn, eventRef, all, raw };
  if (yn.length === 1) return { intent: yn[0], eventRef, all, raw };
  if (hits.includes("status")) return { intent: "status", eventRef, all, raw };
  return { intent: "unknown", eventRef, all, raw };
}
