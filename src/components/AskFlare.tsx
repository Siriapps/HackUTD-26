"use client";

import { useEffect, useRef, useState } from "react";
import { useOps } from "@/store";
import { describeActions } from "@/lib/export/handoff";
import type { Analysis, Dataset } from "@/lib/data/types";
import { fmtClock, fmtHours, fmtMoney, fmtPct } from "./format";

const SUGGESTED = [
  "Which tank trips first and what do we do about it?",
  "Why does S2_FACILITY_C get a shut-in instead of a truck?",
  "What would it cost to do nothing on every failure right now?",
  "Which worn pump should we inspect first and by when?",
  "How are the trucks shared across the system?",
];

/** Plain-text context for Gemini: the live analysis, nothing else. */
function buildContext(ds: Dataset, a: Analysis): string {
  const lines: string[] = [];
  lines.push(`Dataset folder: ${ds.folder}. Console time (now): ${new Date(a.now * 1000).toISOString()}.`);
  lines.push(`Network: ${ds.network.systems.length} systems, ${ds.network.systems.reduce((n, s) => n + s.facilities.length, 0)} facilities. Tank limits: warning ${ds.network.defaults.tank_limits_pct.warning}%, shutdown ${ds.network.defaults.tank_limits_pct.shutdown}%.`);
  lines.push(`Prices: oil $${ds.ops.prices.oil_per_bbl}/bbl, gas $${ds.ops.prices.gas_per_mcf}/mcf. Pump repair takes ${ds.ops.expected_repair_hours.pump_failure} h. Trucks: ${ds.ops.emergency_trucking.truck_capacity_bbl} bbl per trip, $${ds.ops.emergency_trucking.cost_per_trip} per trip.`);
  for (const s of ds.network.systems) {
    const o = ds.ops.systems[s.id];
    lines.push(`System ${s.id}: fleet ${o?.emergency_fleet_size ?? 0} trucks; facilities ${s.facilities.map((f) => `${f.id} (tank ${f.tank.capacity_bbl} bbl, pump ${f.pump.max_flow_bpd} bpd, response ${o?.facilities[f.id]?.response_min} min, cycle ${o?.facilities[f.id]?.cycle_min} min, wells ${f.wells.map((w) => `${w.id} ${w.baseline_water_bpd} bpd water/${w.oil_bpd} oil/${w.gas_mcfd} gas`).join("; ")})`).join(" | ")}.`);
  }
  lines.push(`Fleet now: ${Object.entries(a.fleet).map(([k, f]) => `${k} ${f.committed} of ${f.size} committed`).join(", ")}.`);
  lines.push(`Alerts in progress (${a.alerts.length}), in priority order:`);
  a.alerts.forEach((e, i) => {
    const htl = e.hours_to_limit?.p50;
    const plan = e.plan?.recommended;
    lines.push(
      `${i + 1}. ${e.id} ${e.category} at ${e.facility} (${e.asset}) since ${fmtClock(e.onset_unix)}; ` +
        (htl != null ? `tank ${fmtPct(e.level_pct ?? NaN)}, shutdown in ${fmtHours(htl)} at ${fmtClock(a.now + htl * 3600)}; ` : "no countdown; ") +
        (plan ? `recommended: ${describeActions(plan.actions)} for ${fmtMoney(plan.cost)} (${plan.feasible ? `holds, peak ${fmtPct(plan.peak_level_pct)}` : "still trips"}); alternatives: ${e.plan!.alternatives.slice(0, 4).map((o) => `${o.label} ${fmtMoney(o.cost)} ${o.feasible ? "holds" : "trips"}`).join(", ")}; ` : `action: ${describeActions(e.actions)}; `) +
        `confidence ${Math.round(e.confidence * 100)}%${e.ml_probability != null ? `, scorer ${Math.round(e.ml_probability * 100)}%` : ""}; evidence: ${e.evidence.join(" / ")}`,
    );
  });
  if (a.forecasts.length) lines.push(`Forecasts: ${a.forecasts.map((f) => `${f.pump_id} fails ${f.predicted_fail_unix ? new Date(f.predicted_fail_unix * 1000).toISOString() : "unknown"} (confidence ${Math.round(f.confidence * 100)}%)`).join("; ")}.`);
  if (a.warnings?.length) lines.push(`Early warnings (not yet confirmed): ${a.warnings.map((w) => `${w.facility} ${w.category} ${Math.round(w.probability * 100)}%`).join("; ")}.`);
  const resolved = a.events.filter((e) => e.status === "resolved");
  if (resolved.length) lines.push(`Resolved earlier (${resolved.length}): ${resolved.slice(-8).map((e) => `${e.id} ${e.category} ${e.facility} ${fmtClock(e.onset_unix)}–${e.end_unix ? fmtClock(e.end_unix) : "?"}${e.plan ? ` plan ${fmtMoney(e.plan.recommended.cost)}` : ""}`).join("; ")}.`);
  return lines.join("\n");
}

interface Turn {
  role: "user" | "model";
  text: string;
}

/** Minimal markdown: **bold**, `code`, and line breaks. No library, no HTML injection. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <p className="whitespace-pre-wrap">
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i} className="num">
            {part.slice(2, -2)}
          </strong>
        ) : part.startsWith("`") && part.endsWith("`") ? (
          <code key={i} className="num">
            {part.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  );
}

/** Ask anything about the loaded data, the metrics, the failures and the plans. Grounded in the live analysis. */
export function AskFlare() {
  const dataset = useOps((s) => s.dataset);
  const analysis = useOps((s) => s.analysis);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [turns, busy]);

  async function ask(question: string) {
    if (!dataset || !analysis || !question.trim()) return;
    setQ("");
    setErr(null);
    const next = [...turns, { role: "user" as const, text: question.trim() }];
    setTurns(next);
    setBusy(true);
    try {
      const r = await fetch("/api/gemini/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, context: buildContext(dataset, analysis), history: turns.slice(-6) }),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; text?: string; reason?: string };
      if (!r.ok || !j.ok) setErr(j.reason ?? `Ask failed (${r.status})`);
      else setTurns([...next, { role: "model", text: j.text ?? "" }]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={`ask__fab ${open ? "is-open" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="ask-panel">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M12 3l1.8 4.6L18.5 9.5l-4.7 1.9L12 16l-1.8-4.6L5.5 9.5l4.7-1.9z" />
        </svg>
        Ask Flare
      </button>
      {open && (
        <aside id="ask-panel" className="ask" aria-label="Ask Flare">
          <header className="ask__head">
            <div>
              <p className="font-semibold text-ink-1">Ask Flare</p>
              <p className="text-xs text-ink-3">Gemini, answering from the live analysis of {dataset?.folder ?? "the loaded folder"}. It explains; the optimiser decides.</p>
            </div>
            <button type="button" className="btn btn-quiet h-7" onClick={() => setOpen(false)} aria-label="Close">
              ×
            </button>
          </header>
          <div className="ask__body">
            {turns.length === 0 && (
              <ul className="ask__suggest">
                {SUGGESTED.map((s) => (
                  <li key={s}>
                    <button type="button" onClick={() => ask(s)}>
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {turns.map((t, i) => (
              <div key={i} className={`ask__turn ask__turn--${t.role}`}>
                <Rich text={t.text} />
              </div>
            ))}
            {busy && <div className="ask__turn ask__turn--model text-ink-3">Thinking…</div>}
            {err && <div className="ask__turn ask__turn--model" style={{ color: "var(--shutdown)" }}>{err}</div>}
            <div ref={bottom} />
          </div>
          <form
            className="ask__form"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(q);
            }}
          >
            <input className="select flex-1" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about a facility, a cost, a countdown, a forecast…" aria-label="Question" disabled={busy || !analysis} />
            <button type="submit" className="btn btn-primary" disabled={busy || !q.trim()}>
              Ask
            </button>
          </form>
        </aside>
      )}
    </>
  );
}
