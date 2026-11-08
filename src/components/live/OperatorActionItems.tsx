"use client";

import { useEffect, useMemo, useState } from "react";
import type { Event } from "@/lib/data/types";
import { buildActionItems, type ActionItem, type ActionTone, type ThreadSummary } from "@/lib/live/action-items";
import type { NoteEntry, ReportPayload, RunbookState } from "@/lib/live/types";

type IssueSeverity = "critical" | "normal";

const TONE: Record<ActionTone, { label: string; color: string }> = {
  urgent: { label: "Do first", color: "var(--shutdown)" },
  next: { label: "Then", color: "var(--accent)" },
  info: { label: "Context", color: "var(--text-3)" },
  done: { label: "Handled", color: "var(--ok)" },
};

const SEVERITY_COLOR: Record<IssueSeverity, string> = {
  critical: "var(--shutdown)",
  normal: "var(--accent)",
};

interface FiledIssue {
  actionItemId: string;
  repo: string;
  number: number;
  url: string;
  severity: IssueSeverity;
}

interface Props {
  event?: Event;
  thread?: ThreadSummary | null;
  sessionLive?: boolean;
  runbook: RunbookState | null;
  notes: NoteEntry[];
  report: ReportPayload | null;
  folder: string;
  eventId: string;
}

/** Last card on an event thread: what the operators should do, derived from the incident as it stands now. */
export function OperatorActionItems({ event, thread, sessionLive, runbook, notes, report, folder, eventId }: Props) {
  // Re-evaluate once a minute so "waiting 5 h" stays true while the page is open.
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60_000));
  useEffect(() => {
    const t = setInterval(() => setMinute(Math.floor(Date.now() / 60_000)), 60_000);
    return () => clearInterval(t);
  }, []);
  const items = useMemo(
    () => buildActionItems({ event, thread, sessionLive, runbook, notes, report, nowMs: minute * 60_000 }),
    [event, thread, sessionLive, runbook, notes, report, minute],
  );
  const urgent = items.filter((i) => i.tone === "urgent").length;
  const [repos, setRepos] = useState<string[]>([]);
  const [configured, setConfigured] = useState(true);
  const [filed, setFiled] = useState<FiledIssue[]>([]);
  const [repo, setRepo] = useState("");

  useEffect(() => {
    if (!folder || !eventId) return;
    let cancel = false;
    fetch(`/api/ticket/action?folder=${encodeURIComponent(folder)}&eventId=${encodeURIComponent(eventId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { configured?: boolean; repos?: string[]; issues?: FiledIssue[] }) => {
        if (cancel) return;
        const nextRepos = Array.isArray(j.repos) ? j.repos : [];
        setConfigured(j.configured !== false);
        setRepos(nextRepos);
        setRepo((current) => current || nextRepos[0] || "");
        setFiled(Array.isArray(j.issues) ? j.issues : []);
      })
      .catch(() => {
        if (!cancel) setConfigured(false);
      });
    return () => {
      cancel = true;
    };
  }, [folder, eventId]);

  return (
    <section className="panel mt-8 mb-6" aria-labelledby="operator-actions-title">
      <header className="panel-head">
        <h2 id="operator-actions-title" className="panel-title">
          Action Items for Operators
        </h2>
        <span className="panel-sub num" style={urgent ? { color: "var(--shutdown)" } : undefined}>
          {urgent ? `${urgent} to do first` : `${items.length} item${items.length === 1 ? "" : "s"}`}
        </span>
      </header>
      <ul className="px-4 pt-1 pb-5 flex flex-col gap-4">
        {items.map((it) => (
          <Row
            key={it.id}
            item={it}
            folder={folder}
            eventId={eventId}
            event={event}
            filed={filed.find((f) => f.actionItemId === it.id)}
            repos={repos}
            repo={repo}
            configured={configured}
            onRepo={setRepo}
            onFiled={(issue) => setFiled((prev) => [...prev.filter((p) => p.actionItemId !== issue.actionItemId), issue])}
          />
        ))}
      </ul>
    </section>
  );
}

function Row({
  item,
  folder,
  eventId,
  event,
  filed,
  repos,
  repo,
  configured,
  onRepo,
  onFiled,
}: {
  item: ActionItem;
  folder: string;
  eventId: string;
  event?: Event;
  filed?: FiledIssue;
  repos: string[];
  repo: string;
  configured: boolean;
  onRepo: (repo: string) => void;
  onFiled: (issue: FiledIssue) => void;
}) {
  const t = TONE[item.tone];
  const actionable = item.tone === "urgent" || item.tone === "next";
  const severity: IssueSeverity = item.tone === "urgent" ? "critical" : "normal";
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/ticket/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          folder,
          eventId,
          actionItemId: item.id,
          tone: item.tone,
          title: item.title,
          detail: item.detail,
          repo: repo || undefined,
          context: event ? { facility: event.facility, asset: event.asset, category: event.category } : undefined,
        }),
      });
      const j = (await r.json().catch(() => ({}))) as Partial<FiledIssue> & { ok?: boolean; reason?: string };
      if (!r.ok || !j.ok || !j.url || !j.number || !j.severity) {
        setError(j.reason ?? "GitHub could not create the issue");
        return;
      }
      onFiled({ actionItemId: item.id, repo: j.repo ?? repo, number: j.number, url: j.url, severity: j.severity });
      setOpen(false);
    } catch {
      setError("GitHub could not be reached");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="grid grid-cols-[72px_minmax(0,1fr)] gap-3 items-start">
      <span className="text-xs font-medium num pt-0.5" style={{ color: t.color }}>
        {t.label}
      </span>
      <div className="min-w-0">
        <p className="text-sm text-ink-1 leading-snug">{item.title}</p>
        {item.detail && <p className="mt-1 text-sm text-ink-2 leading-snug">{item.detail}</p>}
        {actionable && filed && (
          <p className="mt-2 flex items-baseline gap-2">
            <a href={filed.url} target="_blank" rel="noreferrer" className="text-sm text-ink-1 underline">
              Issue #{filed.number}
            </a>
            <span className="text-xs font-medium" style={{ color: SEVERITY_COLOR[filed.severity] }}>
              severity: {filed.severity}
            </span>
          </p>
        )}
        {actionable && !filed && !open && (
          <button type="button" className="btn mt-2" onClick={() => { setError(null); setOpen(true); }}>
            Create GitHub Issue
          </button>
        )}
        {actionable && !filed && open && (
          <div className="mt-2 border border-[var(--line-1)] bg-[var(--surface-2)] rounded-md p-3" role="group" aria-label={`File “${item.title}”`}>
            <p className="text-xs font-medium" style={{ color: SEVERITY_COLOR[severity] }}>
              severity: {severity}
            </p>
            <p className="mt-2 text-sm text-ink-1 leading-snug">{item.title}</p>
            {item.detail && <p className="mt-1 text-sm text-ink-2 leading-snug">{item.detail}</p>}
            <p className="mt-2 text-xs text-ink-3 num">Event {eventId}</p>
            <p className="text-xs text-ink-3 num break-all">
              /dispatch/{eventId}?folder={folder || "…"}
            </p>
            {repos.length > 1 ? (
              <label className="mt-2 block text-xs text-ink-3">
                Repository
                <select className="select mt-1 block w-full" value={repo} onChange={(e) => onRepo(e.target.value)}>
                  {repos.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="mt-2 text-xs text-ink-3">{repo ? `Repository ${repo}` : "No repository configured"}</p>
            )}
            {!configured && <p className="mt-2 text-xs text-ink-2">GitHub is not configured.</p>}
            {!folder && <p className="mt-2 text-xs text-ink-2">This thread has no dataset folder, so it cannot be filed.</p>}
            {error && (
              <p className="mt-2 text-xs" style={{ color: "var(--shutdown)" }}>
                {error}
              </p>
            )}
            <div className="mt-3 flex gap-2">
              <button type="button" className="btn btn-primary" disabled={busy || !configured || !folder} onClick={create}>
                {busy ? "Creating…" : "Create issue"}
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}
