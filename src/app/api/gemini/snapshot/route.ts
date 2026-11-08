import { NextResponse } from "next/server";
import { VISION_MODEL, gemini, notConfigured } from "../gemini";

const DEFAULT_QUESTION =
  "This is what I see in front of me right now. In under 80 words: what do you notice, and what is my next runbook step?";

/** Stage fallback when Live is flaky: one JPEG + the same briefing → one text reply. Body: { image: base64 jpeg, systemInstruction, question? }. */
export async function POST(req: Request) {
  const ai = gemini();
  if (!ai) return notConfigured();
  const body = (await req.json().catch(() => null)) as { image?: unknown; systemInstruction?: unknown; question?: unknown } | null;
  if (!body || typeof body.image !== "string" || !body.image || typeof body.systemInstruction !== "string") {
    return NextResponse.json({ ok: false, reason: "image (base64 jpeg) and systemInstruction are required" }, { status: 400 });
  }
  const question = typeof body.question === "string" && body.question.trim() ? body.question.trim() : DEFAULT_QUESTION;
  try {
    const res = await ai.models.generateContent({
      model: VISION_MODEL,
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: body.image } }, { text: question }] }],
      config: { systemInstruction: body.systemInstruction },
    });
    return NextResponse.json({ ok: true, text: res.text ?? "", model: VISION_MODEL });
  } catch (err) {
    return NextResponse.json({ ok: false, reason: `Gemini snapshot: ${(err as Error).message}` }, { status: 502 });
  }
}
