"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useOps } from "@/store";

interface LogEntry {
  at: number;
  dir: "out" | "in";
  text: string;
}
interface OpenAlert {
  key: string;
  eventId: string;
  folder: string;
  handle: string;
  status: "awaiting" | "approved" | "rejected" | "resolved" | "escalated";
  sentAt?: number;
  log: LogEntry[];
}

const STATUS: Record<OpenAlert["status"], { label: string; color: string }> = {
  awaiting: { label: "awaiting reply", color: "var(--cat-failure)" },
  approved: { label: "approved", color: "var(--ok)" },
  rejected: { label: "declined", color: "var(--shutdown)" },
  resolved: { label: "resolved", color: "var(--ok)" },
  escalated: { label: "escalated", color: "var(--shutdown)" },
};

/** Every text out and every reply in, live from the dispatch state (polled). */
export function DispatchLog() {
  const folder = useOps((s) => s.dataset?.folder);
  const fired = useOps((s) => s.fired);
  const [alerts, setAlerts] = useState<OpenAlert[] | null>(null);
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch("/api/dispatch/state", { cache: "no-store" });
        if (r.ok && !stop) setAlerts((await r.json()) as OpenAlert[]);
      } catch {
        /* offline */
      }
    };
    void load();
    const id = setInterval(load, 4000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [fired.length]);
  const rows = (alerts ?? []).filter((a) => !folder || a.folder === folder).sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0));

  return (
    <section className="panel flex flex-col min-h-0">
      <header className="panel-head">
        <h2 className="panel-title">Dispatch log</h2>
        <span className="panel-sub">
          {alerts === null ? "connecting" : `${rows.length} thread${rows.length === 1 ? "" : "s"}`} · iMessage via Photon
        </span>
      </header>
      {rows.length === 0 ? (
        <p className="px-4 py-4 text-sm text-ink-3">Nothing texted yet. Press Play, or tap “Text on-call” on an alert.</p>
      ) : (
        <ol className="overflow-auto min-h-0 divide-y divide-line-1">
          {rows.map((a) => (
            <li key={a.key} className="px-4 py-3 text-sm">
              <div className="flex items-center gap-2">
                <Link href={`/alert/${a.eventId}?folder=${encodeURIComponent(a.folder)}`} className="num font-semibold text-ink-1 hover:underline">
                  {a.eventId}
                </Link>
                <span className="num text-xs text-ink-3">{a.handle}</span>
                <span className="ml-auto text-xs" style={{ color: STATUS[a.status].color }}>
                  {STATUS[a.status].label}
                </span>
              </div>
              <ol className="mt-1.5 space-y-1">
                {a.log.slice(-4).map((l, i) => (
                  <li key={i} className={`flex gap-2 ${l.dir === "in" ? "text-ink-1" : "text-ink-2"}`}>
                    <span className="num text-xs text-ink-3 shrink-0 w-[42px]">{new Date(l.at).toISOString().slice(11, 16)}Z</span>
                    <span className="num text-xs shrink-0 w-3">{l.dir === "in" ? "←" : "→"}</span>
                    <span className="truncate" title={l.text}>
                      {l.text.split("\n")[0]}
                    </span>
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
