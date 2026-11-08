"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useOps } from "@/store";
import { CategoryChip } from "@/components/Category";
import { fmtHours, fmtMoney } from "@/components/format";
import { syncResolutions } from "@/lib/dispatch";
import { recordResolution } from "@/lib/memory";
import type { Event } from "@/lib/data/types";

/** Shape of GET /api/dispatch/state (handles masked server-side). */
interface Thread {
  key: string;
  eventId: string;
  folder: string;
  handle: string;
  sentAt: number;
  status: "awaiting" | "approved" | "rejected" | "resolved" | "escalated";
  choice?: { label: string; cost: number };
  decidedAt?: number;
  decidedBy?: string;
  ackAt?: number;
  escalation?: number;
  watchers?: { role: string; name?: string; handle: string }[];
  resolution?: { at: number; by: string; notes: string[]; photos: string[] };
  log: { at: number; dir: "in" | "out"; text: string; by?: string; intent?: string }[];
}

const POLL_MS = 3000;
const STATUS: Record<Thread["status"], { label: string; fg: string; bg: string }> = {
  awaiting: { label: "Waiting on tech", fg: "var(--warn)", bg: "var(--warn-soft)" },
  approved: { label: "Approved", fg: "var(--ok)", bg: "var(--ok-soft)" },
  rejected: { label: "Choosing option", fg: "var(--text-2)", bg: "var(--surface-3)" },
  escalated: { label: "Needs help", fg: "var(--shutdown)", bg: "var(--shutdown-soft)" },
  resolved: { label: "Fixed", fg: "var(--ok)", bg: "var(--surface-3)" },
};
const RUNG = ["", "reminded", "supervisor paged", "all hands"];
const clock = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const ago = (ms: number) => {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`;
};

/** Live view of every on-call thread: what was sent, who answered, what was decided; ops can decide too. */
export function DispatchBoard() {
  const analysis = useOps((s) => s.analysis);
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [synced, setSynced] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dispatch/state", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setThreads(await res.json());
      setError(null);
      const n = await syncResolutions(recordResolution);
      if (n) setSynced((s) => s + n);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // Poll: the server holds the state; first tick runs immediately.
    const t = setInterval(load, POLL_MS);
    const first = setTimeout(load, 0);
    return () => {
      clearInterval(t);
      clearTimeout(first);
    };
  }, [load]);

  const eventFor = (t: Thread): Event | undefined => (analysis && analysis.folder === t.folder ? analysis.events.find((e) => e.id === t.eventId) : undefined);
  const open = threads?.filter((t) => t.status !== "resolved") ?? [];
  const done = threads?.filter((t) => t.status === "resolved") ?? [];

  return (
    <div className="p-3 grid gap-3 max-w-[1400px] grid-cols-1 min-[1100px]:grid-cols-[minmax(0,1fr)_340px]">
      <section className="panel flex flex-col min-h-0">
        <header className="panel-head">
          <h2 className="panel-title">On-call threads</h2>
          <span className="panel-sub num">
            {threads ? `${open.length} open · ${done.length} fixed` : "loading…"}
            {error ? ` · ${error}` : ""}
          </span>
        </header>
        {threads && !threads.length && (
          <p className="px-4 py-6 text-sm text-ink-2">
            Nothing dispatched yet. Press <span className="text-ink-1">Dispatch</span> on an alert in the{" "}
            <Link href="/" className="underline">
              dashboard
            </Link>{" "}
            to text the on-call tech.
          </p>
        )}
        <ul className="divide-y divide-line-1">
          {[...open, ...done].map((t) => (
            <ThreadRow key={t.key} t={t} event={eventFor(t)} onChanged={load} />
          ))}
        </ul>
      </section>

      <aside className="flex flex-col gap-3">
        <section className="panel">
          <header className="panel-head">
            <h2 className="panel-title">How replies work</h2>
          </header>
          <dl className="px-4 py-3 text-sm grid grid-cols-[72px_1fr] gap-y-1.5 text-ink-2">
            {[
              ["YES", "approve the recommended plan"],
              ["NO", "get numbered options; OPT n picks"],
              ["TRUCKS / SHUT", "switch to that kind of plan"],
              ["OMW", "acknowledge; pauses escalation"],
              ["?", "fresh countdown"],
              ["FIXED", "close; next text or photo is the note"],
              ["HELP", "pages the supervisor now"],
            ].map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="num text-ink-1">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="px-4 pb-3 text-xs text-ink-3">
            No reply escalates on its own: reminder, then supervisor, then everyone, timed from the tank&apos;s countdown.
            {synced ? ` ${synced} field resolution${synced === 1 ? "" : "s"} saved to incident memory.` : ""}
          </p>
        </section>
      </aside>
    </div>
  );
}

function ThreadRow({ t, event, onChanged }: { t: Thread; event?: Event; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const st = STATUS[t.status];
  const htl = event?.hours_to_limit?.p50;

  async function act(command: string) {
    setBusy(command);
    const res = await fetch("/api/dispatch/decide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: t.key, command }),
    }).catch(() => null);
    const json = (await res?.json().catch(() => ({}))) as { message?: string } | undefined;
    setMsg(json?.message?.split("\n")[0] ?? (res ? `HTTP ${res.status}` : "network error"));
    setBusy(null);
    onChanged();
  }

  const actions: [string, string][] =
    t.status === "resolved"
      ? []
      : [
          ["approve", "Approve plan"],
          ...(event?.plan ? ([["trucks", "Trucks"], ["shut in", "Shut in"]] as [string, string][]) : []),
          ["fixed", "Mark fixed"],
          ["help", "Page supervisor"],
        ];

  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-2 flex-wrap min-w-0">
        <span className="num font-semibold text-ink-1">{t.eventId}</span>
        {event && (
          <>
            <Link href={`/facility/${event.facility}`} className="num text-ink-2 hover:underline truncate">
              {event.facility}
            </Link>
            <CategoryChip category={event.category} compact />
          </>
        )}
        <span className="chip" style={{ color: st.fg, background: st.bg }}>
          {st.label}
        </span>
        {(t.escalation ?? 0) > 0 && t.status !== "resolved" && (
          <span className="chip" style={{ color: "var(--shutdown)", background: "var(--shutdown-soft)" }}>
            {RUNG[t.escalation ?? 0] ?? `level ${t.escalation}`}
          </span>
        )}
        {t.ackAt && t.status === "awaiting" && <span className="chip" style={{ color: "var(--text-2)", background: "var(--surface-3)" }}>acknowledged</span>}
        <span className="ml-auto num text-xs text-ink-3">
          to {t.handle} · {ago(t.sentAt)}
        </span>
      </div>

      <div className="mt-1.5 text-sm text-ink-2 flex flex-wrap gap-x-4 gap-y-1">
        {htl != null && t.status !== "resolved" && (
          <span>
            Shutdown in <span className="num text-ink-1">{fmtHours(htl)}</span>
          </span>
        )}
        {t.choice ? (
          <span>
            Plan <span className="text-ink-1">{t.choice.label}</span> <span className="num">{fmtMoney(t.choice.cost)}</span>
            {t.decidedBy && (
              <span className="text-ink-3">
                {" "}
                · {t.decidedBy} {t.decidedAt ? clock(t.decidedAt) : ""}
              </span>
            )}
          </span>
        ) : (
          event?.plan && (
            <span>
              Recommended <span className="text-ink-1">{event.plan.recommended.label}</span>{" "}
              <span className="num">{fmtMoney(event.plan.recommended.cost)}</span>
            </span>
          )
        )}
        {!!t.watchers?.length && <span className="text-ink-3">+ {t.watchers.map((w) => w.name ?? w.role).join(", ")}</span>}
      </div>

      {t.resolution && (
        <p className="mt-1.5 text-sm text-ink-1">
          Fixed by {t.resolution.by} {clock(t.resolution.at)}
          {t.resolution.notes.length ? `: “${t.resolution.notes.join(" / ")}”` : ""}
          {t.resolution.photos.length ? <span className="text-ink-3"> · {t.resolution.photos.length} photo{t.resolution.photos.length === 1 ? "" : "s"}</span> : null}
        </p>
      )}

      <ol className="mt-2 space-y-0.5 text-xs">
        {t.log.slice(-6).map((l, i) => (
          <li key={i} className="grid grid-cols-[42px_64px_minmax(0,1fr)] gap-2 items-baseline">
            <span className="num text-ink-3">{clock(l.at)}</span>
            <span className={l.dir === "in" ? "text-ink-1" : "text-ink-3"}>{l.dir === "in" ? (l.by ?? "reply") : "sent"}</span>
            <span className={`truncate ${l.dir === "in" ? "text-ink-1" : "text-ink-2"}`} title={l.text}>
              {l.text.split("\n")[0] || "—"}
            </span>
          </li>
        ))}
      </ol>

      {actions.length > 0 && (
        <div className="mt-2.5 flex items-center gap-2 flex-wrap">
          {actions.map(([cmd, label]) => (
            <button key={cmd} type="button" className={`btn ${cmd === "approve" ? "btn-primary" : ""}`} disabled={!!busy} onClick={() => act(cmd)}>
              {busy === cmd ? "…" : label}
            </button>
          ))}
          {msg && <span className="text-xs text-ink-3 truncate">{msg}</span>}
        </div>
      )}
    </li>
  );
}
