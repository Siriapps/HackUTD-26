"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useOps } from "@/store";
import { Alerts } from "@/components/Alerts";
import { CATEGORY } from "@/components/Category";
import { FleetCard } from "@/components/FleetCard";
import { HandoffCard } from "@/components/HandoffCard";
import { MapPanel } from "@/components/MapPanel";
import { PlanCompare } from "@/components/PlanCompare";
import { ShutdownRace } from "@/components/ShutdownRace";
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

  // Selection: what the operator picked if it is still in progress, else the alert nearest to shutdown.
  const selected = picked && analysis?.alerts.some((e) => e.id === picked) ? picked : (analysis?.alerts[0]?.id ?? null);
  const event = useMemo(() => analysis?.alerts.find((e) => e.id === selected) ?? null, [analysis, selected]);
  if (!dataset || !analysis) return null;
  const q = `?folder=${encodeURIComponent(dataset.folder)}`;
  const failures = analysis.alerts.filter((e) => e.category === "pump_failure").length;

  return (
    <div className="board p-3">
      <ShutdownRace analysis={analysis} dataset={dataset} selected={selected} onSelect={setSelected} />

      <section className="panel board__queue flex flex-col min-h-0">
        <header className="panel-head">
          <h2 className="panel-title">Queue</h2>
          <span className="panel-sub num">
            {analysis.alerts.length} in progress{failures ? ` · ${failures} filling` : ""}
          </span>
        </header>
        <div className="overflow-auto min-h-0 flex-1">
          <Alerts selected={selected} onSelect={setSelected} />
        </div>
      </section>

      <section className="panel board__stage flex flex-col min-h-0 overflow-hidden">
        <header className="panel-head items-center">
          {event ? (
            <div className="min-w-0 flex items-baseline gap-3">
              <h2 className="panel-title num truncate">{event.facility}</h2>
              <span className="chip" style={{ background: CATEGORY[event.category].wash, color: CATEGORY[event.category].ink }}>
                {CATEGORY[event.category].label}
              </span>
              {event.hours_to_limit && (
                <span className="num text-sm text-ink-2">
                  <strong className="text-ink-1">{fmtHours(event.hours_to_limit.p50)}</strong> to shutdown · {fmtClock(analysis.now + event.hours_to_limit.p50 * 3600)}
                </span>
              )}
            </div>
          ) : (
            <h2 className="panel-title">Network</h2>
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
            {event && (
              <Link href={`/facility/${event.facility}${q}`} className="btn ml-2">
                Open facility
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
            <div className="flex-1 min-h-[260px] relative">
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
                  <PlanCompare event={event} dataset={dataset} compact />
                </>
              ) : (
                <div className="text-sm text-ink-2">
                  <span className="text-xs uppercase tracking-wide text-ink-3 mr-2">Do this now</span>
                  {describeActions(event.actions)} · no countdown, the tank keeps draining.
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
        <HandoffCard />
      </aside>
    </div>
  );
}
