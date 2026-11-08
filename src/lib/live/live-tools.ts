/**
 * Gemini function tool declarations for the Live Incident Response (glasses sessions only).
 *
 * These are appended to FIELD_TOOLS when minting a glasses session token.
 * The phone /field page (LiveSession.tsx) FIELD_TOOLS are unchanged.
 */
import { Type, type FunctionDeclaration } from "@google/genai";

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
      "Only call when asked to close out or draft the final report. " +
      "Only include observations that were actually made — do not fabricate.",
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
      required: ["summary", "observations", "actions", "unresolved"],
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
