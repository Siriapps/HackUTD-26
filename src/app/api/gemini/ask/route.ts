import { NextResponse } from "next/server";
import { VISION_MODEL, gemini, notConfigured } from "../gemini";

const SYSTEM = `You are Flare's analyst for a produced-water network operations console (oil-field salt water: wells → tank → pump → pipeline → disposal site).
Answer the operator's question from the CONTEXT only. It holds the loaded dataset's metadata, every alert in progress with its countdown, evidence, recommended plan, cost and alternatives, the truck fleets, forecasts for worn pumps and the learned scorer's early warnings.
Rules: be concrete and short (under 120 words unless asked for detail); quote the numbers as given; name facilities, wells and costs exactly; when the answer is not in the context say so plainly and suggest where in the console to look (the facility page, timeline, or alert page). Never invent readings, prices or times. Plans and costs come from the physics optimiser; you explain them, you do not recompute them.`;

/** POST { question, context } → { ok, text }. Context is built client-side from the live Analysis. */
export async function POST(req: Request) {
  const ai = gemini();
  if (!ai) return notConfigured();
  const body = (await req.json().catch(() => null)) as { question?: unknown; context?: unknown; history?: unknown } | null;
  if (!body || typeof body.question !== "string" || !body.question.trim()) return NextResponse.json({ ok: false, reason: "question is required" }, { status: 400 });
  const context = typeof body.context === "string" ? body.context.slice(0, 60_000) : "";
  const history = Array.isArray(body.history) ? (body.history as { role: "user" | "model"; text: string }[]).slice(-6) : [];
  try {
    const res = await ai.models.generateContent({
      model: VISION_MODEL,
      contents: [
        ...history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
        { role: "user", parts: [{ text: `CONTEXT:\n${context}\n\nQUESTION: ${body.question.trim()}` }] },
      ],
      config: { systemInstruction: SYSTEM, temperature: 0.2 },
    });
    return NextResponse.json({ ok: true, text: res.text ?? "", model: VISION_MODEL });
  } catch (err) {
    return NextResponse.json({ ok: false, reason: `Gemini: ${(err as Error).message}` }, { status: 502 });
  }
}
