"use client";

import type { NoteEntry } from "@/lib/live/types";

const KIND_STYLE: Record<NoteEntry["kind"], { label: string; color: string }> = {
  observation: { label: "Observed", color: "var(--cat-leak)" },
  confirmation: { label: "Confirmed", color: "var(--ok)" },
  blocked: { label: "Blocked", color: "var(--shutdown)" },
  system: { label: "System", color: "var(--text-3)" },
  escalation: { label: "Escalated", color: "var(--warn)" },
};

function ts(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function IncidentNotes({ notes }: { notes: NoteEntry[] }) {
  return (
    <section className="panel">
      <header className="panel-head">
        <h2 className="panel-title">Technician Notes</h2>
        <span className="panel-sub num">{notes.length} entries</span>
      </header>
      {!notes.length ? (
        <p className="px-4 py-4 text-sm text-ink-3">
          Observations, confirmations, and blocked steps appear here as the session progresses.
        </p>
      ) : (
        <ul className="divide-y divide-line-1 max-h-56 overflow-y-auto">
          {notes.map((n, i) => {
            const style = KIND_STYLE[n.kind] ?? KIND_STYLE.system;
            return (
              <li key={i} className="px-4 py-2.5 flex gap-3 items-baseline">
                <span className="num text-[11px] text-ink-3 shrink-0 w-10">{ts(n.at)}</span>
                <span
                  className="text-xs font-medium shrink-0 w-16"
                  style={{ color: style.color }}
                >
                  {style.label}
                </span>
                <span className="text-sm text-ink-2 leading-snug">{n.text}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
