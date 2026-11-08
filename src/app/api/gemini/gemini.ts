import { GoogleGenAI, Modality, type FunctionDeclaration, type LiveConnectConfig } from "@google/genai";
import { NextResponse } from "next/server";

// Defaults confirmed against aistudio.google.com/docs/live-api (+ /models) on 2026-11-07.
export const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || "gemini-3.8-live";
export const VISION_MODEL = process.env.GEMINI_VISION_MODEL || "gemini-3.6-flash";
export const API_VERSION = process.env.GEMINI_API_VERSION || "v1beta";

/** Server-side client. Null when no key is configured so routes can degrade with a reason. */
export function gemini(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const baseUrl = process.env.GEMINI_BASE_URL; // test hook: point at a local mock
  return new GoogleGenAI({ apiKey, httpOptions: { apiVersion: API_VERSION, ...(baseUrl ? { baseUrl } : {}) } });
}

export const notConfigured = () => NextResponse.json({ ok: false, reason: "GEMINI_API_KEY is not set on the server" }, { status: 503 });

/** Live config locked into every ephemeral token; the client connects with this same object. */
export function liveConfig(systemInstruction: string, tools: FunctionDeclaration[]): LiveConnectConfig {
  return {
    responseModalities: [Modality.AUDIO],
    systemInstruction,
    ...(tools.length ? { tools: [{ functionDeclarations: tools }] } : {}),
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
    contextWindowCompression: { slidingWindow: {} },
  };
}
