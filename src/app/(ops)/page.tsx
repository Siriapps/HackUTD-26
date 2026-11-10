"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useOps } from "@/store";
import { Alerts } from "@/components/Alerts";
import { CATEGORY } from "@/components/Category";
import { FleetCard } from "@/components/FleetCard";
import { DispatchLog } from "@/components/DispatchLog";
import { PlanOfAction } from "@/components/PlanOfAction";
import { MapPanel } from "@/components/MapPanel";
import { PlanCompare } from "@/components/PlanCompare";
import { ShutdownRace } from "@/components/ShutdownRace";
import { ForecastCard } from "@/components/ForecastCard";
import { INFO, InfoTip } from "@/components/InfoTip";
import { WhatIfPanel } from "@/components/WhatIfPanel";
import { Twin3DSlot } from "@/components/Twin3DSlot";
import { fmtClock, fmtHours, fmtMoney } from "@/components/format";
import { describeActions } from "@/lib/export/handoff";
import Link from "next/link";

/**
 * The board. Top: the shutdown race (priority at a glance). Left: the queue. Centre: the selected
 * facility's digital twin with its plan under it (map is a tab). Right: fleet and handoff.
 */
export default function DashboardPage() {
  const router = useRouter();
  const dataset = useOps((s) => s.dataset);
  const analysis = useOps((s) => s.analysis);
  const [picked, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"twin" | "map">("twin");
  const [big, setBig] = useState(false);

  // Selection: what the operator picked if it is still in progress, else the alert nearest to shutdown.
  const selected = picked && analysis?.alerts.some((e) => e.id === picked) ? picked : (analysis?.alerts[0]?.id ?? null);
  const event = useMemo(() => analysis?.alerts.find((e) => e.id === selected) ?? null, [analysis, selected]);
  if (!dataset || !analysis) return null;
  const q = `?folder=${encodeURIComponent(dataset.folder)}`;
  const failures = analysis.alerts.filter((e) => e.category === "pump_failure").length;

  const next = analysis.alerts.find((e) => e.category === "pump_failure" && e.hours_to_limit);
  const nextH = next?.hours_to_limit?.p50 ?? null;
  // Quiet board: the soonest forecast pump failure, so the hero still says what to watch.
  const soonest = [...analysis.forecasts].filter((f) => f.predicted_fail_unix != null && f.predicted_fail_unix > analysis.now).sort((a, b) => a.predicted_fail_unix! - b.predicted_fail_unix!)[0];
  const open = analysis.alerts.length;

  return (
    <div className="board">
      <section className="hero band-dark" aria-label="Next shutdown">
        <div className="hero__inner">
          <div className="hero__next">
            <p className="hero__kicker">{next ? "Next shutdown" : "Network"}</p>
            {next && nextH != null ? (
              <>
                <p className="hero__big num" data-urgent={nextH < 1 || undefined}>
                  {fmtHours(nextH)}
                </p>
                <p className="hero__sub">
                  <span className="num text-ink-1">{next.facility}</span> trips at <span className="num text-ink-1">{fmtClock(analysis.now + nextH * 3600)}</span> if nobody acts ·{" "}
                  {next.plan ? (
                    <>
                      plan <span className="num text-ink-1">{describeActions(next.plan.recommended.actions)}</span> for{" "}
                      <span className="num" style={{ color: "var(--ok-mark)" }}>
                        {fmtMoney(next.plan.recommended.cost)}
                      </span>
                    </>
                  ) : null}
                </p>
                <div className="hero__actions">
                  <button type="button" className="btn btn-primary" onClick={() => setSelected(next.id)}>
                    Show me
                  </button>
                  <Link href={`/alert/${next.id}${q}`} className="btn">
                    Open alert
                  </Link>
                </div>
              </>
            ) : (
              <>
                <p className="hero__big num">{open ? "no shutdown pending" : "all clear"}</p>
                <p className="hero__sub">
                  {open ? (
                    <>
                      Every tank is draining. <span className="num text-ink-1">{open}</span> alert{open === 1 ? "" : "s"} in progress
                      {soonest ? (
                        <>
                          {" "}· <span className="num text-ink-1">{soonest.pump_id}</span> forecast to fail in{" "}
                          <span className="num text-ink-1">{fmtHours((soonest.predicted_fail_unix! - analysis.now) / 3600)}</span>, inspect before{" "}
                          <span className="num text-ink-1">{fmtClock(soonest.predicted_fail_unix!)}</span>
                        </>
                      ) : null}
                      .
                    </>
                  ) : (
                    <>Every pump is moving water and every ratio sits at baseline. Press Play to replay the week, or scrub the clock.</>
                  )}
                </p>
              </>
            )}
          </div>
          <div className="hero__stats num" aria-label="Network health">
            <Stat label="in progress" value={analysis.alerts.length} tone={analysis.alerts.length ? "warn" : "ok"} />
            <Stat label="tanks filling" value={failures} tone={failures ? "bad" : "ok"} />
            <Stat label="trucks committed" value={Object.values(analysis.fleet).reduce((s, f) => s + f.committed, 0)} />
            <Stat label="facilities" value={dataset.network.systems.reduce((n, s) => n + s.facilities.length, 0)} />
          </div>
        </div>
        <div className="hero__race">
          <ShutdownRace analysis={analysis} dataset={dataset} selected={selected} onSelect={setSelected} />
        </div>
      </section>

      <div className="board__grid">

      <section className="panel board__queue flex flex-col min-h-0">
        <header className="panel-head">
          <h2 className="panel-title flex items-center gap-1.5">
            Queue <InfoTip title={INFO.queue.title} align="left">{INFO.queue.body}</InfoTip>
          </h2>
          <span className="panel-sub num">
            {analysis.alerts.length} in progress{failures ? ` · ${failures} filling` : ""}
          </span>
        </header>
        <div className="overflow-auto min-h-0 flex-1">
          <Alerts selected={selected} onSelect={setSelected} />
        </div>
      </section>

      <section className={`panel board__stage flex flex-col min-h-0 overflow-hidden ${big ? "stage--big" : ""}`}>
        <header className="panel-head items-center flex-wrap gap-y-1">
          {event ? (
            <div className="min-w-0 flex items-baseline gap-3 flex-wrap">
              <h2 className="panel-title num shrink-0 flex items-center gap-1.5">
                {event.facility} <InfoTip title={INFO.stage.title} align="left">{INFO.stage.body}</InfoTip>
              </h2>
              <span className="chip" style={{ background: CATEGORY[event.category].wash, color: CATEGORY[event.category].ink }}>
                {CATEGORY[event.category].label}
              </span>
              {event.hours_to_limit && (
                <span className="num text-sm text-ink-2 whitespace-nowrap">
                  <strong className="text-ink-1">{fmtHours(event.hours_to_limit.p50)}</strong> to shutdown · {fmtClock(analysis.now + event.hours_to_limit.p50 * 3600)}
                </span>
              )}
            </div>
          ) : (
            <h2 className="panel-title flex items-center gap-1.5">
              Network <InfoTip title={INFO.stage.title} align="left">{INFO.stage.body}</InfoTip>
            </h2>
          )}
          <div className="flex items-center gap-1 shrink-0">
            <div className="seg" role="tablist" aria-label="Stage view">
              <button type="button" role="tab" aria-selected={view === "twin"} className={view === "twin" ? "is-on" : ""} onClick={() => setView("twin")}>
                Twin
              </button>
              <button type="button" role="tab" aria-selected={view === "map"} className={view === "map" ? "is-on" : ""} onClick={() => setView("map")}>
                Map
              </button>
            </div>
            <button type="button" className="btn ml-1" onClick={() => setBig((b) => !b)} aria-pressed={big} title={big ? "Back to the board" : "Maximise the twin"}>
              {big ? "Close" : "Maximise"}
            </button>
            {event && (
              <Link href={`/alert/${event.id}${q}`} className="btn btn-primary ml-1">
                Open alert
              </Link>
            )}
          </div>
        </header>

        {view === "map" || !event ? (
          <div className="relative flex-1 min-h-[320px]">
            <MapPanel dataset={dataset} analysis={analysis} now={analysis.now} onOpen={(id) => router.push(`/facility/${id}${q}`)} />
            <div className="absolute top-2 right-2 z-[500] panel px-2.5 py-2 text-xs text-ink-2 space-y-1 bg-surface-1/90">
              {(Object.keys(CATEGORY) as (keyof typeof CATEGORY)[]).map((k) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: CATEGORY[k].mark }} /> {CATEGORY[k].label}
                </div>
              ))}
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--ok-mark)" }} /> Healthy facility
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex-1 min-h-[300px] relative band-dark">
              <Twin3DSlot facilityId={event.facility} bare />
            </div>
            <div className="shrink-0 border-t border-line-1 px-4 py-3 overflow-auto max-h-[44%]">
              {event.plan ? (
                <>
                  <div className="flex items-baseline gap-3 mb-2 flex-wrap">
                    <span className="text-xs uppercase tracking-wide text-ink-3">Do this now</span>
                    <span className="num text-lg font-semibold" style={{ color: event.plan.recommended.feasible ? "var(--ok)" : "var(--shutdown)" }}>
                      {fmtMoney(event.plan.recommended.cost)}
                    </span>
                    <span className="text-ink-1">{describeActions(event.plan.recommended.actions)}</span>
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] max-[1600px]:grid-cols-1 gap-5">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-ink-3 mb-1.5">Plan of action</p>
                      <PlanOfAction event={event} dataset={dataset} now={analysis.now} compact />
                    </div>
                    <PlanCompare event={event} dataset={dataset} compact />
                  </div>
                </>
              ) : (
                <div className="text-sm text-ink-2">
                  <span className="text-xs uppercase tracking-wide text-ink-3 mr-2">Do this now</span>
                  {describeActions(event.actions)} · no countdown, the tank keeps draining.
                  {(() => {
                    const f = analysis.forecasts.find((x) => x.pump_id === event.asset || x.facility === event.facility);
                    return f ? <ForecastCard forecast={f} now={analysis.now} repairHours={dataset.ops.expected_repair_hours.pump_failure} className="mt-3" /> : null;
                  })()}
                  <ul className="mt-2 space-y-1">
                    {event.evidence.slice(0, 3).map((l, i) => (
                      <li key={i} className="text-ink-2">
                        {l}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <aside className="board__side flex flex-col gap-3 min-h-0">
        <FleetCard />
        <DispatchLog />
      </aside>
      </div>

      <section className="board__whatif">
        <WhatIfPanel />
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" | "bad" }) {
  const color = tone === "bad" ? "var(--cat-failure-mark)" : tone === "warn" ? "var(--warn)" : tone === "ok" ? "var(--ok-mark)" : "var(--text-1)";
  return (
    <div className="hero__stat">
      <span className="hero__stat-v" style={{ color }}>
        {value}
      </span>
      <span className="hero__stat-l">{label}</span>
    </div>
  );
}
