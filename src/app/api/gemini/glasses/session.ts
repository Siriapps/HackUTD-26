import type { LiveConnectConfig } from "@google/genai";

/**
 * Appended to the field briefing for sessions whose camera is the technician's smart glasses.
 * The phone /field page does not use it.
 */
export const GLASSES_VISION_RULES = [
  "CAMERA: the video comes from the technician's Ray-Ban Meta glasses. It is a first-person, head-mounted view at about one frame per second, low resolution, often at night and blurred by head movement. They hear you through the glasses speakers, so answer in one to three short spoken sentences.",
  "When they ask what they are looking at, what is unusual, or what to inspect next: first say what you can actually see (pipe, flange, valve, fitting, gauge, label, colour, staining, wetness, insulation, supports), then, separately, what it might mean and how sure you are. Use words like 'I can see' for observations and 'that could be' for interpretations.",
  "Describe appearance in plain visual words: colour, shape, a lighter band, a dark patch, a drip mark, a change in diameter. Keep damage words (rupture, bulge, crack, corrosion, leak, seal failure) for the 'that could be' part, and say they are unconfirmed. If the picture looks like a screen, a drawing or a 3D render rather than real equipment, say so.",
  "Never say corrosion, a leak, a crack or a safety hazard is confirmed from the picture alone. Call it a possible sign and name the check that would confirm it: a gauge reading, a closer look with a light, a gas detector, or the runbook step. If the frame is dark, blurry or does not show the equipment, say so and ask them to step closer, hold their head still or add light.",
  "When you call log_observation, write down what the technician said or what is visible, close to their words. Do not add a diagnosis they did not state.",
  "Tie what you see to the event, readings and runbook above when it is relevant, and say when it is not. You are a diagnostic assistant, not a substitute for site safety procedures, lockout/tagout or a gas test.",
].join("\n");

export const GLASSES_MEDIA = {
  /** Frames per second the native client should send; Gemini Live samples video at about 1 fps. */
  videoFps: 1,
  /** Longest edge of each JPEG, in pixels. The aspect ratio is kept. */
  videoMaxEdge: 768,
  videoJpegQuality: 0.6,
  /** Gemini Live audio formats: 16-bit little-endian mono PCM. */
  inputSampleRate: 16000,
  outputSampleRate: 24000,
} as const;

/** Raw WebSocket endpoint for ephemeral tokens; the client appends `?access_token=<token>`. */
export function liveWebSocketUrl(apiVersion: string): string {
  return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.${apiVersion}.GenerativeService.BidiGenerateContentConstrained`;
}

/**
 * The `setup` client message `@google/genai` sends for `ai.live.connect({ model, config })` on the Gemini
 * Developer API, for the fields `liveConfig` uses. Native clients send `{ setup }` as their first frame,
 * so the glasses and the web page open identically configured sessions.
 */
export function liveSetupMessage(model: string, config: LiveConnectConfig): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {};
  if (config.responseModalities) generationConfig.responseModalities = config.responseModalities;
  if (config.speechConfig) generationConfig.speechConfig = config.speechConfig;
  const instruction = config.systemInstruction;
  const setup: Record<string, unknown> = {
    model: model.startsWith("models/") ? model : `models/${model}`,
    generationConfig,
  };
  if (typeof instruction === "string") setup.systemInstruction = { parts: [{ text: instruction }], role: "user" };
  else if (instruction) setup.systemInstruction = instruction;
  if (config.tools?.length) setup.tools = config.tools;
  if (config.inputAudioTranscription) setup.inputAudioTranscription = config.inputAudioTranscription;
  if (config.outputAudioTranscription) setup.outputAudioTranscription = config.outputAudioTranscription;
  if (config.contextWindowCompression) setup.contextWindowCompression = config.contextWindowCompression;
  if (config.sessionResumption) setup.sessionResumption = config.sessionResumption;
  if (config.realtimeInputConfig) setup.realtimeInputConfig = config.realtimeInputConfig;
  return setup;
}

/**
 * Device check for the glasses route. With FIELD_DEVICE_TOKEN set, the app must send it as `x-field-token`;
 * without it the route is dev-only, so a deployed URL cannot be used to mint Gemini sessions.
 */
export function deviceAllowed(req: Request, env: { FIELD_DEVICE_TOKEN?: string; NODE_ENV?: string } = process.env): boolean {
  const token = env.FIELD_DEVICE_TOKEN;
  return token ? req.headers.get("x-field-token") === token : env.NODE_ENV !== "production";
}
