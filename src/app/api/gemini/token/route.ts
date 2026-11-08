import type { FunctionDeclaration } from "@google/genai";
import { NextResponse } from "next/server";
import { API_VERSION, LIVE_MODEL, gemini, liveConfig, notConfigured } from "../gemini";

/** Is Live available? Lets the field page disable the button with a reason before asking for a token. */
export async function GET() {
  return NextResponse.json({ configured: !!process.env.GEMINI_API_KEY, model: LIVE_MODEL, apiVersion: API_VERSION });
}

/**
 * Mint a single-use ephemeral token whose Live config (model, system instruction, tools, transcription)
 * is locked server-side. Body: { systemInstruction: string, tools?: FunctionDeclaration[] }.
 */
export async function POST(req: Request) {
  const ai = gemini();
  if (!ai) return notConfigured();
  const body = (await req.json().catch(() => null)) as { systemInstruction?: unknown; tools?: unknown } | null;
  if (!body || typeof body.systemInstruction !== "string" || !body.systemInstruction.trim()) {
    return NextResponse.json({ ok: false, reason: "systemInstruction (string) is required" }, { status: 400 });
  }
  const tools = Array.isArray(body.tools) ? (body.tools as FunctionDeclaration[]) : [];
  const config = liveConfig(body.systemInstruction, tools);
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  try {
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime: expiresAt,
        newSessionExpireTime: new Date(Date.now() + 2 * 60_000).toISOString(),
        liveConnectConstraints: { model: LIVE_MODEL, config },
      },
    });
    if (!token.name) throw new Error("no token name in response");
    return NextResponse.json({ ok: true, token: token.name, model: LIVE_MODEL, apiVersion: API_VERSION, config, expiresAt });
  } catch (err) {
    return NextResponse.json({ ok: false, reason: `Gemini token: ${(err as Error).message}` }, { status: 502 });
  }
}
