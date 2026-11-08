"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import VisualReportCard from "@/components/VisualReportCard";
import type { EventContext } from "@/lib/events";
import { hoursText, money, pct, utc } from "@/lib/format";
import { describeActions } from "@/lib/memory/briefing";
import { CATEGORY_LABEL, RUNBOOKS, type Feedback, type FeedbackCounts, type FieldNote, type Incident, type VisualReport } from "@/lib/memory/incidents";

export interface FieldCardProps {
  ctx: EventContext;
  incidents: Incident[];
  notes: FieldNote[];
  reports: VisualReport[];
  counts: FeedbackCounts;
  onFeedback: (kind: Feedback) => void;
  onResolve: (text: string) => Promise<void>;
  /** The live-session block, rendered between the plan and the runbook. */
  children?: ReactNode;
}

const SOURCE_LABEL = { history: "from the console history", note: "team note", field: "logged by a technician" } as const;
const KIND_LABEL = { observation: "Observed", confirmation: "Confirmed", escalation: "Escalated", resolution: "Resolved", dismissal: "False alarm" } as const;
const clock = (ms: number) => new Date(ms).toISOString().slice(11, 16);

function Chevron({ className = "" }: { className?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function TankBar({ level, warning, shutdown }: { level: number; warning: number; shutdown: number }) {
  return (
    <div className="mt-6">
      <div className="tank-track" role="img" aria-label={`Tank at ${pct(level)}; warning at ${warning} %, shutdown at ${shutdown} %`}>
        <div className="tank-fill" style={{ width: `${Math.max(0, Math.min(100, level))}%` }} />
        <span className="tank-tick" style={{ left: `${warning}%` }} />
        <span className="tank-tick" data-kind="shutdown" style={{ left: `${shutdown}%` }} />
      </div>
      <div className="num mt-2.5 flex justify-between text-[14px] text-[var(--muted)]">
        <span>
          <span className="font-semibold text-[var(--text)]">{pct(level)}</span> now
        </span>
        <span>{warning} % warning</span>
        <span className="text-[var(--red)]">{shutdown} % shutdown</span>
      </div>
    </div>
  );
}

export default function FieldCard({ ctx, incidents, notes, reports, counts, onFeedback, onResolve, children }: FieldCardProps) {
  const { event: e, facility, now } = ctx;
  const plan = e.plan;
  const label = CATEGORY_LABEL[e.category];
  const runbook = RUNBOOKS[e.category];
  const fleet = ctx.fleet ?? { size: ctx.ops.systems[ctx.system.id]?.emergency_fleet_size ?? 0, committed: plan?.trucks_used ?? 0 };
  const [outcome, setOutcome] = useState("");
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const feedback = counts[e.category];

  async function save() {
    if (!outcome.trim()) return;
    setSaving("saving");
    await onResolve(outcome.trim());
    setSaving("saved");
  }

  return (
    <>
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[var(--line)] bg-[color-mix(in_oklab,var(--bg)_88%,transparent)] px-4 py-3 backdrop-blur-md">
        <Link href={ctx.folder && ctx.folder !== "fixture" ? `/?folder=${encodeURIComponent(ctx.folder)}` : "/"} className="-ml-1 flex min-h-11 items-center gap-0.5 pr-2 text-[15px] text-[var(--muted)]">
          <Chevron className="rotate-180" />
          Console
        </Link>
        <span className="num text-[14px] text-[var(--muted)]">{e.id}</span>
        <span className="chip">{label}</span>
      </header>

      <section className="px-4 pb-5 pt-5">
        <h1 className="text-[28px] font-semibold leading-8 tracking-[-0.01em]">{facility.id}</h1>
        <p className="mt-1.5 text-[15px] leading-6 text-[var(--muted)]">
          {label} on <span className="num text-[var(--text)]">{e.asset}</span> since {utc(e.onset_unix)}, {hoursText((now - e.onset_unix) / 3600)} ago
        </p>
        {e.hours_to_limit && e.level_pct != null ? (
          <div className="mt-7">
            <p className="text-[15px] text-[var(--muted)]">Tank shuts down in</p>
            <p className="num mt-1 text-[64px] font-semibold leading-none tracking-[-0.03em]" aria-label={hoursText(e.hours_to_limit.p50)}>
              {Math.floor(e.hours_to_limit.p50)}
              <span className="text-[26px] font-medium text-[var(--muted)]"> h </span>
              {String(Math.round((e.hours_to_limit.p50 % 1) * 60)).padStart(2, "0")}
              <span className="text-[26px] font-medium text-[var(--muted)]"> min</span>
            </p>
            <p className="mt-2 text-[15px] leading-6 text-[var(--muted)]">
              around <span className="num text-[var(--text)]">{utc(now + e.hours_to_limit.p50 * 3600)}</span>, likely between{" "}
              <span className="num">{e.hours_to_limit.p10.toFixed(1)}</span> and <span className="num">{e.hours_to_limit.p90.toFixed(1)}</span> h
              {e.lost_revenue_per_hr != null ? (
                <>
                  . Shut in, this site loses <span className="num text-[var(--text)]">{money(e.lost_revenue_per_hr)}</span> an hour
                </>
              ) : null}
            </p>
            <TankBar level={e.level_pct} warning={ctx.limits.warning} shutdown={ctx.limits.shutdown} />
          </div>
        ) : (
          <div className="mt-7">
            <p className="text-[15px] text-[var(--muted)]">No countdown. The pump is still running and the tank is draining.</p>
            <p className="mt-2 text-[22px] font-medium leading-7">{e.evidence[0]}</p>
          </div>
        )}
      </section>

      <section className="mx-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-[var(--cat)]">Do this now</h2>
          {plan ? <span className="num text-[18px] font-semibold">{money(plan.recommended.cost)}</span> : null}
        </div>
        <p className="mt-2 text-[20px] font-semibold leading-7">{plan ? plan.recommended.label : `Inspect ${e.asset}`}</p>
        <ul className="mt-2 space-y-1.5 text-[16px] leading-6 text-[var(--muted)]">
          {plan ? describeActions(plan.recommended.actions, ctx).map((line) => <li key={line}>{line}</li>) : <li>No trucks or shut-ins needed. Work the runbook below and log what you find.</li>}
        </ul>
        {plan ? (
          <p className="num mt-3 text-[14px] leading-5 text-[var(--dim)]">
            Peak {pct(plan.recommended.peak_level_pct)} · repair ends {utc(plan.horizon_end_unix)} · {plan.trucks_used} of {fleet.size} trucks
          </p>
        ) : null}
        {plan?.alternatives.length ? (
          <details className="mt-3 border-t border-[var(--line)] pt-3">
            <summary className="flex min-h-11 items-center justify-between text-[15px] text-[var(--muted)]">
              Other options the console priced
              <Chevron className="rotate-90" />
            </summary>
            <ul className="mt-1 space-y-2.5">
              {plan.alternatives.map((o) => (
                <li key={o.label} className="flex items-baseline justify-between gap-3 text-[15px] leading-5">
                  <span className={o.feasible ? "" : "text-[var(--dim)]"}>
                    {o.label}
                    {o.feasible ? "" : " (tank still trips)"}
                  </span>
                  <span className="num flex-none">{money(o.cost)}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <div className="mt-4 flex gap-2">
          <button type="button" className="btn btn-ghost btn-sm flex-1" onClick={() => onFeedback("confirm")}>
            Plan confirmed
          </button>
          <button type="button" className="btn btn-ghost btn-sm flex-1" onClick={() => onFeedback("dismiss")}>
            False alarm
          </button>
        </div>
        <p className="mt-2 text-[13px] leading-5 text-[var(--dim)]">
          {label} alerts on this device: {feedback.confirm} confirmed, {feedback.dismiss} dismissed.
        </p>
      </section>

      {children}

      {reports.length ? (
        <section className="px-4 pt-7">
          <h2 className="text-[15px] font-semibold text-[var(--muted)]">What the camera showed</h2>
          <div className="mt-3 space-y-3">
            {reports
              .slice()
              .reverse()
              .map((r) => (
                <VisualReportCard key={r.id} report={r} />
              ))}
          </div>
        </section>
      ) : null}

      <section className="px-4 pt-7">
        <h2 className="text-[15px] font-semibold text-[var(--muted)]">Runbook</h2>
        <p className="mt-1 text-[15px] font-medium leading-6 text-[var(--cat)]">{runbook.rule}</p>
        <ol className="mt-2 divide-y divide-[var(--line)]">
          {runbook.steps.map((step) => (
            <li key={step}>
              <label className="flex min-h-14 items-center gap-3 py-2 text-[17px] leading-6">
                <input type="checkbox" className="check" />
                <span>{step}</span>
              </label>
            </li>
          ))}
        </ol>
      </section>

      <section className="px-4 pt-7">
        <h2 className="text-[15px] font-semibold text-[var(--muted)]">Last time this happened</h2>
        {incidents.length ? (
          <ol className="mt-1 divide-y divide-[var(--line)]">
            {incidents.map((i) => (
              <li key={i.id} className="py-3.5">
                <p className="text-[15px] leading-5 text-[var(--muted)]">{i.summary}</p>
                <p className="mt-1.5 text-[16px] leading-6">{i.outcome}</p>
                <p className="num mt-1.5 text-[13px] text-[var(--dim)]">
                  {i.system}
                  {i.facility ? ` · ${i.facility}` : ""} · {SOURCE_LABEL[i.source]}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-[15px] leading-6 text-[var(--dim)]">Nothing similar on record yet. Close this one out below and it becomes the first.</p>
        )}
      </section>

      <section className="px-4 pt-7">
        <h2 className="text-[15px] font-semibold text-[var(--muted)]">Close out</h2>
        <p className="mt-1 text-[15px] leading-6 text-[var(--muted)]">What you found and what fixed it. The next technician sees this under &ldquo;last time this happened&rdquo;.</p>
        <textarea
          className="mt-3"
          rows={3}
          value={outcome}
          onChange={(ev) => {
            setOutcome(ev.target.value);
            setSaving("idle");
          }}
          placeholder="VFD overcurrent fault, one reset held, pump back at 03:40"
          aria-label="Outcome"
        />
        <button type="button" className="btn btn-ghost mt-3 w-full" disabled={!outcome.trim() || saving === "saving"} onClick={save}>
          {saving === "saved" ? "Saved to memory" : saving === "saving" ? "Saving…" : "Save outcome and close the ticket"}
        </button>
      </section>

      <section className="px-4 pt-7">
        <h2 className="text-[15px] font-semibold text-[var(--muted)]">Why the console flagged it</h2>
        <ul className="mt-2 space-y-2 text-[16px] leading-6">
          {e.evidence.map((line) => (
            <li key={line} className="flex gap-3">
              <span className="mt-[11px] h-1.5 w-1.5 flex-none rounded-full bg-[var(--cat)]" aria-hidden />
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[14px] text-[var(--dim)]">Confidence {Math.round(e.confidence * 100)} %</p>
        <details className="mt-2">
          <summary className="flex min-h-11 items-center justify-between text-[15px] font-semibold text-[var(--muted)]">
            Readings at {utc(now)}
            <Chevron className="rotate-90" />
          </summary>
          <table className="num mt-1 w-full text-[14px]">
            <tbody>
              {ctx.readings.map((r) => (
                <tr key={`${r.asset}|${r.metric}`} className="border-t border-[var(--line)]">
                  <td className="py-1.5 pr-2 text-[var(--muted)]">{r.asset}</td>
                  <td className="py-1.5 pr-2 text-[var(--dim)]">{r.metric}</td>
                  <td className="py-1.5 text-right">{Number.isInteger(r.value) ? r.value : r.value.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      {notes.length ? (
        <section className="px-4 pt-7">
          <h2 className="text-[15px] font-semibold text-[var(--muted)]">Field log</h2>
          <ol className="mt-1 divide-y divide-[var(--line)]">
            {notes
              .slice()
              .reverse()
              .map((n) => (
                <li key={n.at} className="py-2.5 text-[15px] leading-6">
                  <span className="num text-[13px] text-[var(--dim)]">{clock(n.at)}</span> <span className="font-semibold">{KIND_LABEL[n.kind]}</span>
                  {n.text ? `: ${n.text}` : ""}
                </li>
              ))}
          </ol>
        </section>
      ) : null}
      <div className="h-8" />
    </>
  );
}
