"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useOps, type Fired } from "@/store";
import { CATEGORY } from "./Category";
import { fmtClock, fmtHours, fmtMoney } from "./format";
import { describeActions } from "@/lib/export/handoff";

const STAGE_MS = 420;

/**
 * The moment an alert fires. Each stage checks off in turn so the room can read it:
 * Detected → Countdown → Priced → Texted. The data is real; the pacing is for humans.
 */
export function FiringToast() {
  const fired = useOps((s) => s.fired);
  const analysis = useOps((s) => s.analysis);
  const folder = useOps((s) => s.dataset?.folder ?? "");
  const clear = useOps((s) => s.clearFired);
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    if (!fired.length) return;
    const id = setInterval(() => setNowMs(Date.now()), 200);
    return () => clearInterval(id);
  }, [fired.length]);
  if (!fired.length || !analysis || !nowMs) return null;
  const recent = fired.filter((f) => nowMs - f.firedAt < 60_000).slice(0, 3);
  if (!recent.length) return null;

  return (
    <div className="firing" role="status" aria-live="polite">
      {recent.map((f) => (
        <FiredCard key={`${f.eventId}-${f.firedAt}`} f={f} nowMs={nowMs} folder={folder} event={analysis.alerts.find((e) => e.id === f.eventId)} />
      ))}
      <button type="button" className="firing__dismiss" onClick={clear} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}

function FiredCard({ f, nowMs, folder, event }: { f: Fired; nowMs: number; folder: string; event?: { hours_to_limit?: { p50: number } | null; plan?: { recommended: { cost: number; actions: import("@/lib/data/types").Action[] } } } }) {
  const age = nowMs - f.firedAt;
  const stage = (i: number) => age >= i * STAGE_MS;
  const cat = CATEGORY[f.category];
  const htl = event?.hours_to_limit?.p50;
  const steps: { label: string; detail: string; state: "done" | "active" | "todo" | "off" }[] = [
    { label: "Detected", detail: `${cat.label} at ${f.facility} · ${fmtClock(f.atUnix)}`, state: stage(0) ? "done" : "active" },
    {
      label: "Countdown",
      detail: htl != null ? `${fmtHours(htl)} to shutdown` : "no countdown (inspection)",
      state: stage(1) ? "done" : stage(0) ? "active" : "todo",
    },
    {
      label: "Priced",
      detail: event?.plan ? `${fmtMoney(event.plan.recommended.cost)} · ${describeActions(event.plan.recommended.actions)}` : "field inspection",
      state: stage(2) ? "done" : stage(1) ? "active" : "todo",
    },
    {
      label: "Texted",
      detail:
        f.text === "sent" ? `on-call ${f.textNote ?? ""}`.trim() : f.text === "dry" ? `not sent (${f.textNote ?? "dry run"})` : f.text === "failed" ? `failed: ${f.textNote ?? ""}` : f.text === "sending" ? "sending…" : "auto-text off",
      state: f.text === "sent" ? "done" : f.text === "sending" ? "active" : f.text === null ? "off" : "done",
    },
  ];
  return (
    <article className="firing__card" style={{ borderLeftColor: cat.ink }}>
      <header className="firing__head">
        <span className="chip" style={{ background: cat.wash, color: cat.ink }}>
          {cat.label}
        </span>
        <Link href={`/alert/${f.eventId}?folder=${encodeURIComponent(folder)}`} className="num text-ink-1 font-semibold hover:underline">
          {f.facility}
        </Link>
        <span className="num text-xs text-ink-3 ml-auto">{fmtClock(f.atUnix)}</span>
      </header>
      <ol className="firing__steps">
        {steps.map((s) => (
          <li key={s.label} data-state={s.state}>
            <span className="firing__dot" aria-hidden />
            <span className="firing__label">{s.label}</span>
            <span className="firing__detail num">{s.detail}</span>
          </li>
        ))}
      </ol>
    </article>
  );
}
