/**
 * GET /api/live/state?folder=&eventId=
 *
 * Returns a LiveSnapshot for first paint and refresh restoration.
 * Merges Tiger-persisted data with any in-process hub memory.
 * Never prerendered (uses `connection()`).
 */
import { connection } from "next/server";
import { NextResponse } from "next/server";
import { loadLive, loadLiveMessages } from "@/lib/db/incidents";
import { getLog, getMaxSeq } from "@/lib/live/hub";
import type { LiveSnapshot, TranscriptLine } from "@/lib/live/types";

export async function GET(req: Request) {
  await connection();

  const url = new URL(req.url);
  const folder = url.searchParams.get("folder") ?? "";
  const eventId = url.searchParams.get("eventId") ?? "";

  if (!eventId.trim()) {
    return NextResponse.json({ ok: false, error: "eventId required" }, { status: 400 });
  }

  // 1. Try hub (fastest, in-memory).
  const hubLog = getLog(folder, eventId);
  const hubMaxSeq = getMaxSeq(folder, eventId);

  // 2. Merge with Tiger-persisted snapshot.
  const persisted = await loadLive(folder, eventId);

  // 3. Build transcript lines from hub final events (partials excluded from hub log).
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

  // If hub has no lines (e.g. after restart), try Tiger messages.
  let dbLines: TranscriptLine[] = [];
  if (!lines.length && eventId) {
    const msgs = await loadLiveMessages(folder, eventId);
    dbLines = msgs.map((m) => {
      const p = m.payload as { sessionId?: string; seq?: number; role?: string; turnId?: string } | null;
      return {
        id: `msg-${m.ts}`,
        role: (m.dir === "in" ? "tech" : "gemini") as "tech" | "gemini" | "system",
        text: m.body,
        turnId: p?.turnId ?? `${m.ts}`,
        at: m.ts as number,
      };
    });
  }

  const snapshot: LiveSnapshot = {
    sessionId: persisted?.sessionId ?? null,
    simulation: persisted?.simulation ?? false,
    maxSeq: Math.max(hubMaxSeq, persisted?.maxSeq ?? -1),
    lines: lines.length ? lines : dbLines,
    runbook: persisted?.runbook ?? null,
    notes: persisted?.notes ?? [],
    report: persisted?.report ?? null,
  };

  return NextResponse.json(snapshot);
}
