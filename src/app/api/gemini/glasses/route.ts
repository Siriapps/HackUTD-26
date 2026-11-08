import { NextResponse, connection } from "next/server";
import { serverAnalysis, serverDataset, serverFolders } from "@/lib/dispatch/server-data";
import { eventContext, type EventContext } from "@/lib/events";
import { CATEGORY_LABEL, FIELD_TOOLS, buildBriefing, similar } from "@/lib/memory";
import { FIXTURES } from "@/lib/memory/fixture";
import { API_VERSION, LIVE_MODEL, gemini, liveConfig, notConfigured } from "../gemini";
import { GLASSES_MEDIA, GLASSES_VISION_RULES, deviceAllowed, liveSetupMessage, liveWebSocketUrl } from "./session";

/**
 * Live session for the native Meta glasses client (experiments/meta-sdk-poc/ios). The event context, briefing,
 * tools and token are built here from the same code the /field page runs in the browser; the phone then talks to
 * Gemini directly over WebSocket, so no camera or microphone data passes through this server.
 */

const forbidden = () => NextResponse.json({ ok: false, reason: "forbidden: send x-field-token (FIELD_DEVICE_TOKEN)" }, { status: 403 });

async function defaultFolder(): Promise<string | undefined> {
  const folders = await serverFolders();
  return folders.includes("test") ? "test" : folders[0];
}

async function resolveContext(eventId: string, folder?: string): Promise<EventContext | null> {
  const fixture = FIXTURES[eventId];
  if (fixture) return fixture;
  const f = folder || (await defaultFolder());
  if (!f) return null;
  const [dataset, analysis] = await Promise.all([serverDataset(f), serverAnalysis(f)]);
  const event = analysis.events.find((e) => e.id === eventId);
  return event ? eventContext(dataset, analysis, event) : null;
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

/** Body: { eventId: string, folder?: string }. Returns a single-use token plus the exact `setup` frame to send. */
export async function POST(req: Request) {
  if (!deviceAllowed(req)) return forbidden();
  const ai = gemini();
  if (!ai) return notConfigured();
  const body = (await req.json().catch(() => null)) as { eventId?: unknown; folder?: unknown } | null;
  if (!body || typeof body.eventId !== "string" || !body.eventId.trim()) {
    return NextResponse.json({ ok: false, reason: "eventId (string) is required" }, { status: 400 });
  }
  const folder = typeof body.folder === "string" && body.folder.trim() ? body.folder.trim() : undefined;
  let ctx: EventContext | null;
  try {
    ctx = await resolveContext(body.eventId.trim(), folder);
  } catch (err) {
    return NextResponse.json({ ok: false, reason: `could not load ${folder ?? "the dataset"}: ${(err as Error).message}` }, { status: 404 });
  }
  if (!ctx) return NextResponse.json({ ok: false, reason: `No event ${body.eventId}${folder ? ` in ${folder}` : ""}` }, { status: 404 });

  const incidents = similar(ctx.event, ctx);
  const briefing = `${buildBriefing(ctx, incidents)}\n\n${GLASSES_VISION_RULES}`;
  const config = liveConfig(briefing, FIELD_TOOLS);
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
    return NextResponse.json({
      ok: true,
      token: token.name,
      model: LIVE_MODEL,
      apiVersion: API_VERSION,
      wsUrl: liveWebSocketUrl(API_VERSION),
      setup: liveSetupMessage(LIVE_MODEL, config),
      expiresAt,
      media: GLASSES_MEDIA,
      folder: ctx.folder,
      event: ctx.event,
      eventLabel: `${CATEGORY_LABEL[ctx.event.category]} on ${ctx.event.asset}`,
      incidents: incidents.map((i) => ({ summary: i.summary, outcome: i.outcome, source: i.source })),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, reason: `Gemini token: ${(err as Error).message}` }, { status: 502 });
  }
}
