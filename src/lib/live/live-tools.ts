/**
 * Gemini function tool declarations for the Live Incident Response (glasses sessions only).
 *
 * These are appended to FIELD_TOOLS when minting a glasses session token.
 * The phone /field page (LiveSession.tsx) FIELD_TOOLS are unchanged.
 */
import { Type, type FunctionDeclaration } from "@google/genai";

/**
 * Appended to every glasses briefing (not only simulation). The operator's screen is driven by these tool calls:
 * speaking a step aloud changes nothing on it.
 */
export const LIVE_TOOL_RULES = `
LIVE INCIDENT TRACKING (mandatory, every call): the operator is watching a runbook, a notes pane and a report pane that ONLY change when you call tools. Saying something aloud does not update them.
- The runbook steps are numbered 1..N in the briefing. Tool step_index is 0-based: step 1 is step_index 0, step 2 is 1, and so on.
- When you start walking the technician through a step, call update_runbook_step with status in_progress BEFORE you speak the instruction. Do this for every step, one at a time.
- Call log_observation for every fact the technician reports or you can see (readings, fault codes, wet or stained pipe, valve positions). Use their words; one or two sentences; do not wait to be asked.
- When the technician says a step is done, call update_runbook_step with status completed and technician_confirmed true. Never mark completed on your own. If a step cannot be done, call it with status blocked and a short observation giving the reason.
- When the technician asks to finalize, close out, wrap up or write the incident report, call draft_incident_report IMMEDIATELY in that turn, using only what was observed or done in this call (pass empty lists for anything unknown; never refuse and never say you cannot write reports: you can, through this tool). Then say in one sentence what the draft covers and ask whether to submit it.
- Call submit_incident_report with technician_confirmed true only after the technician clearly says yes to submitting. If they hesitate, do not submit.
- Tool results tell you whether the screen accepted the change. If a result says a step was not accepted or confirmation is needed, tell the technician plainly and ask again.
- Never answer a closeout request with generic statements such as being a language model; use the tools.
`.trim();

export const LIVE_TOOLS: FunctionDeclaration[] = [
  {
    name: "update_runbook_step",
    description:
      "Update the status of one runbook step. Call after the technician performs or evaluates a step. " +
      "Use status 'in_progress' when starting, 'completed' only when the technician explicitly confirms they did it, " +
      "'blocked' when the step cannot be performed (must include an observation explaining why). " +
      "Never set completed without technician_confirmed true.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        step_index: {
          type: Type.NUMBER,
          description: "0-based index of the runbook step.",
        },
        status: {
          type: Type.STRING,
          description: "One of: in_progress, completed, blocked.",
        },
        observation: {
          type: Type.STRING,
          description: "What was seen, heard, or reported. Required for blocked steps.",
        },
        technician_confirmed: {
          type: Type.BOOLEAN,
          description: "true only when the technician explicitly says they did or confirmed the step.",
        },
      },
      required: ["step_index", "status", "technician_confirmed"],
    },
  },
  {
    name: "draft_incident_report",
    description:
      "Create a draft incident response report from observed evidence. " +
      "Call this immediately when the technician asks to finalize, close out or write the incident report; do not refuse. " +
      "Only include observations that were actually made — do not fabricate. Omit any list you have nothing for; the server fills it from the logged notes and runbook.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        summary: {
          type: Type.STRING,
          description: "One paragraph summarising the incident, findings, and actions taken.",
        },
        observations: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "List of confirmed observations from the session.",
        },
        actions: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "List of actions taken or planned.",
        },
        unresolved: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "Issues that remain unresolved after this session.",
        },
      },
      required: ["summary"],
    },
  },
  {
    name: "submit_incident_report",
    description:
      "Submit the drafted incident report for review. Only call after the technician confirms they want to submit. " +
      "Requires a draft to exist. Sets the report to 'submitted' state.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        technician_confirmed: {
          type: Type.BOOLEAN,
          description: "Must be true — the technician must explicitly confirm before submission.",
        },
      },
      required: ["technician_confirmed"],
    },
  },
];
