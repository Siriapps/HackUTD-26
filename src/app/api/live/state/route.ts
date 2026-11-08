/**
 * GET /api/live/state?folder=&eventId=
 *
 * Returns a LiveSnapshot for first paint and refresh restoration.
 * The in-memory hub snapshot is authoritative; Tiger-persisted data fills in after a restart.
 * Never prerendered (uses `connection()`).
 */
import { connection } from "next/server";
import { NextResponse } from "next/server";
import { loadLive, loadLiveMessages } from "@/lib/db/incidents";
import { getLive, getLog, getMaxSeq } from "@/lib/live/hub";
import type { IncidentLive, LiveSnapshot, TranscriptLine } from "@/lib/live/types";

export async function GET(req: Request) {
  await connection();

  const url = new URL(req.url);
  const folder = url.searchParams.get("folder") ?? "";
  const eventId = url.searchParams.get("eventId") ?? "";

  if (!eventId.trim()) {
    return NextResponse.json({ ok: false, error: "eventId required" }, { status: 400 });
  }

  // 1. Hub (fastest, in-memory).
  const hubLog = getLog(folder, eventId);
  const hubMaxSeq = getMaxSeq(folder, eventId);

  // 2. Live snapshot: memory first, Tiger after a restart. A DB error must not blank the page.
  let live: IncidentLive | null = getLive(folder, eventId);
  if (!live) {
    live = await loadLive(folder, eventId).catch((err) => {
      console.error("[live/state] loadLive failed:", err instanceof Error ? err.message : err);
      return null;
    });
  }

  // 3. Transcript lines from hub final events (partials excluded from the hub log).
  const lines: TranscriptLine[] = hubLog
    .filter((e) => e.type === "transcript.final")
    .map((e) => {
      const p = e.payload as { role: string; text: string; turnId: string } | null;
      return {
        id: e.id,
        role: (p?.role ?? "system") as "tech" | "gemini" | "system",
        text: p?.text ?? "",
        turnId: p?.turnId ?? e.id,
        at: e.at,
      };
    });

  // If the hub has no lines (e.g. after restart), try Tiger messages.
  let dbLines: TranscriptLine[] = [];
  if (!lines.length) {
    const msgs = await loadLiveMessages(folder, eventId).catch(() => []);
    dbLines = msgs.map((m, i) => {
      const p = m.payload as { sessionId?: string; seq?: number; role?: string; turnId?: string; id?: string } | null;
      return {
        id: p?.id ?? `msg-${m.ts}-${i}`,
        role: (p?.role ?? (m.dir === "in" ? "tech" : "gemini")) as "tech" | "gemini" | "system",
        text: m.body,
        turnId: p?.turnId ?? `${m.ts}`,
        at: Number(m.ts),
      };
    });
  }

  const snapshot: LiveSnapshot = {
    sessionId: live?.sessionId ?? null,
    simulation: live?.simulation ?? false,
    maxSeq: Math.max(hubMaxSeq, live?.maxSeq ?? -1),
    lines: lines.length ? lines : dbLines,
    runbook: live?.runbook ?? null,
    notes: live?.notes ?? [],
    report: live?.report ?? null,
  };

  return NextResponse.json(snapshot);
}
