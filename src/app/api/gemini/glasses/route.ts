import { NextResponse, connection } from "next/server";
import { randomUUID } from "crypto";
import { serverAnalysis, serverFolders } from "@/lib/dispatch/server-data";
import type { EventContext } from "@/lib/events";
import { appendLiveLine } from "@/lib/dispatch/store";
import { FIXTURES } from "@/lib/memory/fixture";
import { findEventContext, normalizeEventId } from "@/lib/live/lookup";
import { buildLiveRunbookContext } from "@/lib/live/runbook-context";
import { CATEGORY_LABEL, FIELD_TOOLS, buildBriefing, similar } from "@/lib/memory";
import { API_VERSION, LIVE_MODEL, gemini, liveConfig, notConfigured } from "../gemini";
import { GLASSES_MEDIA, GLASSES_VISION_RULES, deviceAllowed, liveSetupMessage, liveWebSocketUrl } from "./session";
import { LIVE_TOOLS, LIVE_TOOL_RULES } from "@/lib/live/live-tools";
import { SIMULATION_RULES } from "@/lib/live/simulation";

/**
 * Live session for the native Meta glasses client (experiments/meta-sdk-poc/ios). The event
 * context, briefing, tools and token are built here from the same code the /field page runs in
 * the browser; the phone then talks to Gemini directly over WebSocket, so no camera or
 * microphone data passes through this server.
 *
 * Changes vs original:
 * - body.simulation === true appends SIMULATION_RULES to the briefing.
 * - LIVE_TOOLS (update_runbook_step, draft_incident_report, submit_incident_report) are always
 *   included for glasses sessions so the web incident page can track runbook progress.
 * - A sessionId (UUID) is generated and returned; iOS includes it on every live event.
 * - body.simulation is returned on the grant so iOS can persist and display it.
 */

const forbidden = () => NextResponse.json({ ok: false, reason: "forbidden: send x-field-token (FIELD_DEVICE_TOKEN)" }, { status: 403 });

async function defaultFolder(): Promise<string | undefined> {
  const folders = await serverFolders();
  return folders.includes("test") ? "test" : folders[0];
}

/** Status plus the events the app can open: `?folder=` or the same default folder as /field. */
export async function GET(req: Request) {
  await connection();
  if (!deviceAllowed(req)) return forbidden();
  const folder = new URL(req.url).searchParams.get("folder") || (await defaultFolder());
  const analysis = folder ? await serverAnalysis(folder).catch(() => null) : null;
  const live = (analysis?.events ?? []).filter((e) => e.status === "ongoing");
  const fixtures = Object.values(FIXTURES).map((c) => c.event);
  return NextResponse.json({
    configured: !!process.env.GEMINI_API_KEY,
    model: LIVE_MODEL,
    folder: folder ?? null,
    events: [...fixtures, ...live].map((e) => ({ id: e.id, label: CATEGORY_LABEL[e.category], facility: e.facility, asset: e.asset, status: e.status })),
  });
}

/**
 * Body: { eventId: string, folder?: string, simulation?: boolean }
 * Returns: token + setup frame + sessionId + simulation flag
 *
 * simulation defaults to false. When true, SIMULATION_RULES are appended to the briefing so
 * Gemini treats displayed laptop imagery as the incident's visual evidence.
 */
export async function POST(req: Request) {
  if (!deviceAllowed(req)) return forbidden();
  const ai = gemini();
  if (!ai) return notConfigured();
  const body = (await req.json().catch(() => null)) as {
    eventId?: unknown;
    folder?: unknown;
    simulation?: unknown;
  } | null;
  if (!body || typeof body.eventId !== "string" || !body.eventId.trim()) {
    return NextResponse.json({ ok: false, reason: "eventId (string) is required" }, { status: 400 });
  }
  const folder = typeof body.folder === "string" && body.folder.trim() ? body.folder.trim() : undefined;
  const simulation = body.simulation === true;

  // The technician typed an event id on the phone: attach to that event when any dataset has it, otherwise this is a
  // NEW incident and gets its own thread (ad-hoc, no telemetry) so the live page, runbook and notes still work.
  const eventId = normalizeEventId(body.eventId);
  let ctx: EventContext | null;
  try {
    ctx = await findEventContext(eventId, folder);
  } catch (err) {
    return NextResponse.json({ ok: false, reason: `could not look up ${eventId}: ${(err as Error).message}` }, { status: 500 });
  }

  const adhocFolder = folder ?? (await defaultFolder()) ?? "adhoc";
  const incidents = ctx ? similar(ctx.event, ctx) : [];
  const resolvedFolder = ctx ? ctx.folder : adhocFolder;
  if (!ctx) {
    try {
      appendLiveLine(adhocFolder, eventId, { at: Date.now(), dir: "out", text: `New incident ${eventId} opened from the glasses. No telemetry on record; using the general runbook.`, by: "system" });
    } catch (err) {
      console.error("[glasses] could not open thread:", err instanceof Error ? err.message : err);
    }
  }

  const identity = ctx
    ? buildBriefing(ctx, incidents)
    : [
        `You are Avon's night-shift field assistant on a live call with a lone technician at night. They are reporting a NEW incident, ${eventId}, that is not in the monitoring system: there are no sensor readings, countdown, plan or past incidents for it.`,
        "Rules: be concrete and brief. Short sentences, one instruction at a time. Never invent readings, asset ids or history. Safety first: lockout/tagout before anything is touched. If something is not stated by the technician or visible on camera, say you do not know and ask.",
        "Tools: log_observation for anything they report or you see; escalate when they need help; confirm_plan is not applicable here.",
      ].join("\n");

  // Briefing = identity/context + the deterministic, event-tailored runbook + glasses and tool rules (+ simulation overlay).
  let briefingText = `${identity}\n\n${buildLiveRunbookContext(ctx, eventId)}\n\n${GLASSES_VISION_RULES}\n\n${LIVE_TOOL_RULES}`;
  if (simulation) {
    briefingText += `\n\n${SIMULATION_RULES}`;
  }

  // Glasses sessions get FIELD_TOOLS + LIVE_TOOLS.
  const allTools = [...FIELD_TOOLS, ...LIVE_TOOLS];
  const config = liveConfig(briefingText, allTools);
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();

  // Stable session identifier for the full glasses call (survives Gemini reconnects).
  const sessionId = randomUUID();

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
    return NextResponse.json({
      ok: true,
      token: token.name,
      model: LIVE_MODEL,
      apiVersion: API_VERSION,
      wsUrl: liveWebSocketUrl(API_VERSION),
      setup: liveSetupMessage(LIVE_MODEL, config),
      expiresAt,
      media: GLASSES_MEDIA,
      folder: resolvedFolder,
      event: ctx ? ctx.event : { id: eventId, category: "unknown", facility: "", asset: "", status: "ongoing", evidence: [], adhoc: true },
      eventLabel: ctx ? `${CATEGORY_LABEL[ctx.event.category]} on ${ctx.event.asset}` : `New incident ${eventId}`,
      known: !!ctx,
      incidents: incidents.map((i) => ({ summary: i.summary, outcome: i.outcome, source: i.source })),
      /** New fields for Live Incident Response */
      sessionId,
      simulation,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, reason: `Gemini token: ${(err as Error).message}` }, { status: 502 });
  }
}
