import { Type, type Schema } from "@google/genai";
import { NextResponse } from "next/server";
import { VISION_MODEL, gemini, notConfigured } from "../gemini";

const SEVERITIES = ["low", "medium", "high", "critical"];

const SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    observed_condition: { type: Type.STRING, description: "One sentence on the physical state of the equipment that is visible" },
    severity: { type: Type.STRING, format: "enum", enum: SEVERITIES },
    components_visible: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Equipment you can identify: pump, motor, VFD panel, tank, pipeline, valve, gauge, leak, spill, ..." },
    matches_telemetry: { type: Type.BOOLEAN, description: "True when what is visible is consistent with the event and readings in the briefing" },
    notes: { type: Type.STRING, description: "What the day crew should know, under 60 words" },
  },
  required: ["observed_condition", "severity", "components_visible", "matches_telemetry", "notes"],
};

/**
 * Video analysis report (PLAN item 18): keyframes from the Live session + logged observations → structured JSON.
 * Body: { systemInstruction, frames: base64 jpeg[] (≤ 8), observations?: string[] }.
 */
export async function POST(req: Request) {
  const ai = gemini();
  if (!ai) return notConfigured();
  const body = (await req.json().catch(() => null)) as { systemInstruction?: unknown; frames?: unknown; observations?: unknown } | null;
  const frames = Array.isArray(body?.frames) ? body!.frames.filter((f): f is string => typeof f === "string" && f.length > 0).slice(0, 8) : [];
  if (!body || typeof body.systemInstruction !== "string" || !frames.length) {
    return NextResponse.json({ ok: false, reason: "systemInstruction and at least one frame are required" }, { status: 400 });
  }
  const observations = Array.isArray(body.observations) ? body.observations.filter((o): o is string => typeof o === "string") : [];
  const prompt =
    `These ${frames.length} keyframes were captured in time order by the technician's phone during the call.` +
    (observations.length ? ` The technician logged: ${observations.map((o) => `"${o}"`).join("; ")}.` : "") +
    " Write the visual report for this event. Judge only from what is visible and the briefing; if the frames show nothing useful, say so in observed_condition and set severity to low.";
  try {
    const res = await ai.models.generateContent({
      model: VISION_MODEL,
      contents: [{ role: "user", parts: [...frames.map((data) => ({ inlineData: { mimeType: "image/jpeg", data } })), { text: prompt }] }],
      config: { systemInstruction: body.systemInstruction, responseMimeType: "application/json", responseSchema: SCHEMA },
    });
    const parsed = JSON.parse(res.text ?? "{}") as Record<string, unknown>;
    const report = {
      observed_condition: String(parsed.observed_condition ?? ""),
      severity: SEVERITIES.includes(String(parsed.severity)) ? String(parsed.severity) : "low",
      components_visible: Array.isArray(parsed.components_visible) ? parsed.components_visible.map(String) : [],
      matches_telemetry: Boolean(parsed.matches_telemetry),
      notes: String(parsed.notes ?? ""),
    };
    return NextResponse.json({ ok: true, report, model: VISION_MODEL });
  } catch (err) {
    return NextResponse.json({ ok: false, reason: `Gemini report: ${(err as Error).message}` }, { status: 502 });
  }
}
