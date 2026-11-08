"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useOps } from "@/store";
import { handoffText, planLine } from "@/lib/export/handoff";
import { dispatch } from "@/lib/export/notify";
import { fmtClock, fmtHours, fmtMoney, fmtPct } from "./format";

/**
 * The 30-second shift handoff. Structured for the eye (the morning crew scans it), the same
 * deterministic text for the clipboard and the SMS. Nothing here is computed: it reads Analysis.
 */
export function HandoffCard() {
  const analysis = useOps((s) => s.analysis);
  const dataset = useOps((s) => s.dataset);
  const [status, setStatus] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const text = useMemo(() => (analysis && dataset ? handoffText(analysis, dataset) : ""), [analysis, dataset]);
  if (!analysis || !dataset) return null;
  const { alerts, now, fleet } = analysis;
  const failures = alerts.filter((e) => e.category === "pump_failure");
  const inspections = alerts.filter((e) => e.category !== "pump_failure");
  const committed = Object.entries(fleet).filter(([, f]) => f.committed > 0);
  const q = `?folder=${encodeURIComponent(dataset.folder)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied");
    } catch {
      setStatus("Clipboard blocked: select the text and copy");
    }
    setTimeout(() => setStatus(null), 2500);
  }
  async function post() {
    if (!armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 4000);
      return;
    }
    setArmed(false);
    setStatus("Sending…");
    const res = await dispatch({ type: "handoff", folder: dataset!.folder, now: analysis!.now, text, links: { dashboard: `/${q}` } });
    setStatus(res.message);
  }

  return (
    <section className="panel flex flex-col min-h-0">
      <header className="panel-head">
        <h2 className="panel-title">Shift handoff</h2>
        <span className="panel-sub num">{fmtClock(now)} · 30 s read</span>
      </header>
      <div className="px-4 pt-3 pb-2 text-sm overflow-auto min-h-0 space-y-3">
        {!alerts.length ? (
          <p className="text-ink-2">All systems nominal: no pump failures, leaks or worn pumps in progress.</p>
        ) : (
          <p className="text-ink-2">
            <span className="num text-ink-1 font-semibold">{failures.length}</span> pump failure{failures.length === 1 ? "" : "s"},{" "}
            <span className="num text-ink-1 font-semibold">{inspections.filter((e) => e.category === "pipeline_leak").length}</span> leak,{" "}
            <span className="num text-ink-1 font-semibold">{inspections.filter((e) => e.category === "pump_degradation").length}</span> worn pumps in progress.
          </p>
        )}

        {failures.length > 0 && (
          <ol className="space-y-2">
            {failures.map((e, i) => {
              const htl = e.hours_to_limit?.p50;
              return (
                <li key={e.id} className="grid grid-cols-[14px_minmax(0,1fr)_auto] gap-x-2 items-baseline">
                  <span className="num text-ink-3">{i + 1}</span>
                  <span className="min-w-0">
                    <Link href={`/facility/${e.facility}${q}`} className="num font-semibold text-ink-1 hover:underline">
                      {e.facility}
                    </Link>
                    <span className="block text-ink-2">
                      failed <span className="num">{fmtClock(e.onset_unix)}</span>
                      {e.level_pct != null && (
                        <>
                          {" "}
                          · tank <span className="num">{fmtPct(e.level_pct)}</span>
                        </>
                      )}
                      {htl != null && (
                        <>
                          {" "}
                          · shutdown in <span className="num">{fmtHours(htl)}</span> (<span className="num">{fmtClock(now + htl * 3600)}</span>)
                        </>
                      )}
                    </span>
                    <span className="block text-ink-1">{planLine(e).replace(/\s*\(\$[\d,]+\)$/, "")}</span>
                  </span>
                  {e.plan && (
                    <span className="num font-semibold" style={{ color: e.plan.recommended.feasible ? "var(--ok)" : "var(--shutdown)" }}>
                      {fmtMoney(e.plan.recommended.cost)}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        {inspections.length > 0 && (
          <div>
            <p className="text-xs uppercase tracking-wide text-ink-3 mb-1">Inspections</p>
            <ul className="space-y-1">
              {inspections.map((e) => (
                <li key={e.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 text-ink-2">
                  <Link href={`/facility/${e.facility}${q}`} className="num text-ink-1 hover:underline whitespace-nowrap">
                    {e.asset}
                  </Link>
                  <span className="min-w-0">
                    {e.category === "pipeline_leak" ? "leak" : "wearing out"}
                    {e.evidence[0] ? <span className="text-ink-3"> · {e.evidence[0]}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {committed.length > 0 && (
          <p className="text-ink-2">
            Trucks:{" "}
            {committed.map(([sys, f], i) => (
              <span key={sys}>
                {i > 0 ? ", " : ""}
                <span className="num text-ink-1">{sys}</span> <span className="num">{f.committed}</span> of <span className="num">{f.size}</span> committed
              </span>
            ))}
            ; other systems have their full fleet free.
          </p>
        )}
      </div>
      <div className="px-4 pb-3 pt-1 flex items-center gap-2 text-xs">
        <button type="button" className="btn" onClick={copy}>
          Copy text
        </button>
        <button type="button" className={`btn ${armed ? "btn-primary" : ""}`} onClick={post} aria-live="polite">
          {armed ? "Tap again to text" : "Text morning crew"}
        </button>
        {status && <span className="text-ink-3 truncate">{status}</span>}
      </div>
    </section>
  );
}
