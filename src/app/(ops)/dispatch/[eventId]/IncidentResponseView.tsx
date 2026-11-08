"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useOps } from "@/store";
import { CategoryChip } from "@/components/Category";
import { LiveTranscript } from "@/components/live/LiveTranscript";
import { RunbookPanel } from "@/components/live/RunbookPanel";
import { IncidentNotes } from "@/components/live/IncidentNotes";
import { IncidentReport } from "@/components/live/IncidentReport";
import { CATEGORY } from "@/components/Category";
import type {
  LiveEvent,
  LiveSnapshot,
  NoteEntry,
  ReportPayload,
  RunbookState,
  TranscriptLine,
  TranscriptPayload,
  RunbookUpdatePayload,
  NoteAppendPayload,
} from "@/lib/live/types";

const BACKOFF = [1000, 2000, 4000, 8000, 15000];

interface SessionMeta {
  sessionId: string | null;
  simulation: boolean;
  live: boolean; // has an active SSE connection and recent events
}

export function IncidentResponseView({ eventId }: { eventId: string }) {
  const params = useSearchParams();
  const storeFolder = useOps((s) => s.dataset?.folder ?? "");
  const folder = params.get("folder") ?? storeFolder;

  const analysis = useOps((s) => s.analysis);
  const event = analysis?.events.find((e) => e.id === eventId);

  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [runbook, setRunbook] = useState<RunbookState | null>(null);
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [session, setSession] = useState<SessionMeta>({ sessionId: null, simulation: false, live: false });
  const [status, setStatus] = useState<"loading" | "connected" | "reconnecting" | "error">("loading");

  const seqRef = useRef(-1);
  const seenRef = useRef(new Set<string>());

  // ── Load snapshot (first paint + after reconnect) ─────────────────────────
  const loadSnapshot = useCallback(async () => {
    try {
      const r = await fetch(`/api/live/state?folder=${encodeURIComponent(folder)}&eventId=${encodeURIComponent(eventId)}`, { cache: "no-store" });
      if (!r.ok) return;
      const snap: LiveSnapshot = await r.json();
      seqRef.current = Math.max(seqRef.current, snap.maxSeq);
      setLines(snap.lines);
      setRunbook(snap.runbook);
      setNotes(snap.notes);
      setReport(snap.report);
      setSession({ sessionId: snap.sessionId, simulation: snap.simulation, live: false });
    } catch {
      /* snapshot errors are non-fatal; SSE delivers updates */
    }
  }, [folder, eventId]);

  // ── Apply a live event to local state ────────────────────────────────────
  const applyEvent = useCallback((ev: LiveEvent) => {
    if (seenRef.current.has(ev.id)) return;
    seenRef.current.add(ev.id);
    if (ev.seq > seqRef.current) seqRef.current = ev.seq;

    switch (ev.type) {
      case "session.start": {
        const p = ev.payload as { simulation?: boolean } | null;
        setSession({ sessionId: ev.sessionId, simulation: p?.simulation ?? false, live: true });
        break;
      }
      case "session.end": {
        setSession((s) => ({ ...s, live: false }));
        break;
      }
      case "transcript.partial": {
        const p = ev.payload as TranscriptPayload;
        const turnId = p.turnId;
        setLines((prev) => {
          // Replace the existing partial for this turnId or append a new one.
          const existingIdx = prev.findIndex((l) => l.turnId === turnId && l.open);
          const updated: TranscriptLine = {
            id: ev.id,
            role: p.role,
            text: p.text,
            turnId,
            at: ev.at,
            open: true,
          };
          if (existingIdx >= 0) {
            const next = [...prev];
            next[existingIdx] = updated;
            return next;
          }
          return [...prev, updated];
        });
        break;
      }
      case "transcript.final": {
        const p = ev.payload as TranscriptPayload;
        setLines((prev) => {
          // Close any open partial with the same turnId first.
          const withoutPartial = prev.filter((l) => !(l.turnId === p.turnId && l.open));
          return [
            ...withoutPartial,
            { id: ev.id, role: p.role, text: p.text, turnId: p.turnId, at: ev.at, open: false },
          ];
        });
        break;
      }
      case "runbook.update": {
        const p = ev.payload as RunbookUpdatePayload;
        setRunbook((prev) => {
          if (!prev) return prev;
          const steps = prev.steps.map((s) =>
            s.index === p.stepIndex
              ? { ...s, status: p.status, observation: p.observation ?? s.observation, technicianConfirmed: p.technicianConfirmed, at: ev.at }
              : s,
          );
          return { ...prev, steps };
        });
        break;
      }
      case "note.append": {
        const p = ev.payload as NoteAppendPayload;
        setNotes((prev) => [...prev, { at: ev.at, kind: p.kind, text: p.text }]);
        break;
      }
      case "report.draft": {
        const p = ev.payload as Omit<ReportPayload, "status" | "technicianConfirmed">;
        setReport({ ...p, status: "draft", technicianConfirmed: false });
        break;
      }
      case "report.ready": {
        setReport((prev) => prev ? { ...prev, status: "ready_for_review" } : prev);
        break;
      }
      case "report.submit": {
        setReport((prev) => prev ? { ...prev, status: "submitted", technicianConfirmed: true } : prev);
        break;
      }
    }
  }, []);

  // ── SSE connection with reconnect ─────────────────────────────────────────
  useEffect(() => {
    if (!eventId || !folder) return;
    let es: EventSource | null = null;
    let attempt = 0;
    let cancelled = false;

    async function connect() {
      await loadSnapshot();
      if (cancelled) return;

      const url = `/api/live/stream?folder=${encodeURIComponent(folder)}&eventId=${encodeURIComponent(eventId)}&afterSeq=${seqRef.current}`;
      es = new EventSource(url);
      setStatus("connected");

      es.onmessage = (e) => {
        try {
          const event: LiveEvent = JSON.parse(e.data);
          applyEvent(event);
          setSession((s) => ({ ...s, live: true }));
          attempt = 0; // reset backoff on success
        } catch {
          /* malformed frame — ignore */
        }
      };

      es.onerror = () => {
        es?.close();
        es = null;
        if (cancelled) return;
        setStatus("reconnecting");
        const delay = BACKOFF[Math.min(attempt, BACKOFF.length - 1)];
        attempt++;
        setTimeout(() => { if (!cancelled) void connect(); }, delay);
      };
    }

    void connect();
    return () => {
      cancelled = true;
      es?.close();
    };
  }, [eventId, folder, loadSnapshot, applyEvent]);

  // ── Ops actions ───────────────────────────────────────────────────────────
  const confirmStep = useCallback(async (stepIndex: number) => {
    const r = await fetch("/api/live/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ folder, eventId, action: "step", stepIndex }),
    });
    const json = await r.json() as { ok: boolean; message?: string; error?: string };
    if (!json.ok) throw new Error(json.error ?? "confirm failed");
  }, [folder, eventId]);

  const handleReportAction = useCallback(async (action: "ready" | "submit") => {
    const r = await fetch("/api/live/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ folder, eventId, action }),
    });
    const json = await r.json() as { ok: boolean; message?: string; error?: string };
    if (!json.ok) throw new Error(json.error ?? "action failed");
  }, [folder, eventId]);

  // ── Derived display ───────────────────────────────────────────────────────
  const categoryInfo = event?.category ? CATEGORY[event.category] : null;
  const categoryColor = categoryInfo?.ink ?? "var(--cat-failure)";

  const statusLabel =
    status === "loading" ? "Loading…" :
    status === "reconnecting" ? "Reconnecting…" :
    session.live ? "Session live" :
    "Session idle";

  const statusColor =
    session.live ? "var(--ok)" :
    status === "reconnecting" ? "var(--warn)" :
    "var(--text-3)";

  return (
    <div className="p-3 flex flex-col gap-3 max-w-[1400px] min-h-0">
      {/* Header */}
      <header className="flex items-center gap-3 flex-wrap">
        <Link href="/dispatch" className="btn text-sm py-1 px-2.5 flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
          On-call
        </Link>

        <span className="num font-semibold text-ink-1 text-lg">{eventId}</span>

        {event && (
          <>
            <CategoryChip category={event.category} />
            <span className="text-ink-3 text-sm">{event.facility}</span>
          </>
        )}

        <span
          className="chip ml-auto text-xs"
          style={{ color: statusColor, background: statusColor + "22" }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 shrink-0"
            style={{ background: statusColor, opacity: session.live ? 1 : 0.4 }}
          />
          {statusLabel}
        </span>

        {session.simulation && (
          <span className="chip text-xs" style={{ color: "var(--cat-degradation)", background: "var(--cat-degradation-soft)" }}>
            Simulation
          </span>
        )}
      </header>

      {/* Main two-column layout */}
      <div className="grid gap-3 min-h-0 grid-cols-1 min-[1100px]:grid-cols-[minmax(0,1fr)_360px]">
        {/* Left — transcript */}
        <section className="panel flex flex-col min-h-0">
          <header className="panel-head">
            <h2 className="panel-title">Live Gemini conversation</h2>
            {session.sessionId && (
              <span className="panel-sub num text-ink-3 truncate max-w-[200px]" title={session.sessionId}>
                {session.sessionId.slice(0, 8)}…
              </span>
            )}
          </header>
          <LiveTranscript lines={lines} categoryColor={categoryColor} />
        </section>

        {/* Right — runbook */}
        <RunbookPanel
          runbook={runbook}
          eventId={eventId}
          folder={folder}
          onConfirmStep={confirmStep}
        />
      </div>

      {/* Notes + Report row */}
      <div className="grid gap-3 grid-cols-1 min-[900px]:grid-cols-2">
        <IncidentNotes notes={notes} />
        <IncidentReport
          report={report}
          folder={folder}
          eventId={eventId}
          onAction={handleReportAction}
        />
      </div>

      {/* Footer always present per rules */}
      <footer className="sr-only">© 2026 Avon Corps</footer>
    </div>
  );
}
