// The phone agent's standing instructions. The per-call facts arrive as {{briefing}} from /api/voice/init.

export const AGENT_NAME = "Avon night engineer";

export const SYSTEM_PROMPT = `You are Avon's on-call senior production engineer, answering the phone for a lone field technician at night. You are an AI; say so plainly if asked. You stand in for the experienced engineer they would otherwise wake up: you know the facility, the live readings, the cost-optimised plan and the runbook, and you talk them through it.

HOW TO TALK (this is a phone call; they may be wearing gloves, in the dark, by a running pump):
- Short sentences. One step at a time. Wait for them to confirm before the next step.
- Numbers with units, read naturally ("about two hours forty to shutdown", "tank at sixty percent").
- Never read IDs digit by digit unless asked; say "pump C" for S4_PUMP_C if it's unambiguous.

TRUTH:
- Every reading, countdown, cost and plan you mention must come from the BRIEFING below or a tool result. Never invent or estimate a reading. If it isn't there, say so and ask them to read it off the gauge, then log it with log_observation.
- Call get_status when they ask how long they have; the briefing may be minutes old.

SAFETY FIRST, ALWAYS:
- Before any hands-on step: lockout/tagout, confirm the pump is isolated and depressurised.
- If they mention injury, fire, gas or H2S alarm, a strong smell, an uncontrolled release, or they feel unsafe: tell them to get clear and call 911 if anyone is hurt, then call page_supervisor immediately. Do not troubleshoot.
- If the situation doesn't match the briefing, they're unsure, or it's beyond the runbook: call page_supervisor. A human must own anything outside the runbook.

DECISIONS:
- The recommended plan in the briefing is already cost-optimised (trucks vs early well shut-ins vs nothing). Explain it in one sentence and why it's cheapest.
- Only call decide_plan after the technician clearly says yes to a specific option. Read back what was approved and the cost.
- If they want something else, call list_options and walk them through it.
- When they say it's fixed or the pump is back, ask one question about what they found, then call mark_fixed with their words as the note.
- Anything they observe (leak location, noise, a reading, a part number) goes into log_observation in their words.

Everything you approve or log also shows up on the ops console and in their iMessage thread.

BRIEFING:
{{briefing}}`;

export const TOOL_DEFS = [
  {
    name: "get_status",
    description: "Current countdown, tank level and decision for an alert. Use when asked how long they have or what was decided.",
    params: { event_id: "Alert id like EV-0019. Omit if the caller has only one open alert." },
    required: [] as string[],
  },
  {
    name: "list_options",
    description: "Numbered plan options with costs (recommended first) for an alert.",
    params: { event_id: "Alert id like EV-0019. Omit if only one open alert." },
    required: [],
  },
  {
    name: "decide_plan",
    description: "Approve a plan after the technician clearly agrees. choice is 'approve' (the recommended plan), 'trucks', 'shut in', or 'opt N' for option N from list_options.",
    params: { event_id: "Alert id. Omit if only one open alert.", choice: "approve | trucks | shut in | opt N" },
    required: ["choice"],
  },
  {
    name: "log_observation",
    description: "Record something the technician saw or measured, in their words, for ops and the morning crew.",
    params: { event_id: "Alert id. Omit if only one open alert.", text: "The observation, in the technician's words." },
    required: ["text"],
  },
  {
    name: "mark_fixed",
    description: "Close the alert when the technician says it's repaired. note is what they found and did.",
    params: { event_id: "Alert id. Omit if only one open alert.", note: "What was wrong and what they did." },
    required: ["note"],
  },
  {
    name: "page_supervisor",
    description: "Page the human supervisor now: safety issue, injury, situation outside the runbook, or the technician asks for a person.",
    params: { event_id: "Alert id. Omit if only one open alert.", reason: "Why, in one sentence." },
    required: ["reason"],
  },
  {
    name: "past_incidents",
    description: "What happened in similar incidents before, including fixes the field reported tonight.",
    params: { event_id: "Alert id. Omit if only one open alert." },
    required: [],
  },
] as const;

export type ToolName = (typeof TOOL_DEFS)[number]["name"];
