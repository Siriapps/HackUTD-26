"use client";

import type { Analysis, Dataset, Event } from "@/lib/data/types";
import { fmtClock, fmtHours } from "./format";
import { TruckGlyph } from "./TruckGlyph";
import { INFO, InfoTip } from "./InfoTip";

/**
 * The shutdown race: every filling tank as a bar from "now" toward its shutdown line, nearest
 * first. One glance gives the order of the night. Bars are the recommended plan's reality:
 * a tank that holds runs to repair end and stops short of the red line; a tank that trips
 * hits it. Click a lane to select that alert.
 */
export function ShutdownRace({
  analysis,
  dataset,
  selected,
  onSelect,
}: {
  analysis: Analysis;
  dataset: Dataset;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const failures = analysis.alerts.filter((e) => e.category === "pump_failure");
  if (!failures.length) return null;
  const now = analysis.now;
  const repairH = dataset.ops.expected_repair_hours.pump_failure;
  const end = Math.max(...failures.map((e) => e.plan?.horizon_end_unix ?? e.onset_unix + repairH * 3600), now + 3600);
  const span = end - now;
  const x = (t: number) => Math.min(100, Math.max(0, ((t - now) / span) * 100));
  const hourTicks: number[] = [];
  for (let t = Math.ceil(now / 3600) * 3600; t <= end; t += 3600) hourTicks.push(t);
  const laneH = 34;
  const H = failures.length * laneH;

  return (
    <section className="race" aria-label="Shutdown race: filling tanks ordered by time to shutdown">
      <header className="race__head">
        <h2 className="panel-title flex items-center gap-1.5">
          Shutdown race <InfoTip title={INFO.race.title} align="left">{INFO.race.body}</InfoTip>
        </h2>
        <span className="panel-sub">
          <span className="num">{failures.length}</span> tank{failures.length === 1 ? "" : "s"} filling · bars show the recommended plan · <span style={{ color: "var(--shutdown)" }}>■</span> trips
          {" · "}
          <span style={{ color: "var(--ok)" }}>■</span> holds
        </span>
      </header>
      <div className="race__body">
        <ol className="race__names">
          {failures.map((e, i) => (
            <li key={e.id} style={{ height: laneH }}>
              <button type="button" className={`race__name ${selected === e.id ? "is-selected" : ""}`} onClick={() => onSelect(e.id)}>
                <span className="num text-ink-3">{i + 1}</span>
                <span className="num text-ink-1 truncate">{e.facility}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="race__chart">
          <svg width="100%" height={H + 18} viewBox={`0 0 100 ${H + 18}`} preserveAspectRatio="none" aria-hidden>
            {hourTicks.map((t) => (
              <line key={t} x1={x(t)} x2={x(t)} y1={0} y2={H} stroke="var(--line-1)" strokeWidth={0.15} vectorEffect="non-scaling-stroke" />
            ))}
            {failures.map((e, i) => (
              <Lane key={e.id} e={e} i={i} laneH={laneH} x={x} now={now} repairH={repairH} selected={selected === e.id} onSelect={onSelect} />
            ))}
          </svg>
          <div className="race__ticks num" aria-hidden>
            <span style={{ left: 0 }}>now {fmtClock(now)}</span>
            {hourTicks
              .filter((t) => x(t) > 9)
              .map((t) => (
                <span key={t} style={{ left: `${x(t)}%` }}>
                  {fmtClock(t)}
                </span>
              ))}
          </div>
          {/* Labels live in HTML so they scale with text, not with the SVG. */}
          {failures.map((e, i) => {
            const htl = e.hours_to_limit?.p50;
            const trips = e.trips_at_unix && (!e.plan || !e.plan.recommended.feasible) ? e.trips_at_unix : null;
            const holdsEnd = e.plan?.horizon_end_unix ?? e.onset_unix + repairH * 3600;
            const labelAt = x(trips ?? holdsEnd);
            return (
              <button
                key={e.id}
                type="button"
                className="race__label num"
                style={{ top: i * laneH + laneH / 2, left: `min(calc(${labelAt}% + 8px), calc(100% - 150px))` }}
                onClick={() => onSelect(e.id)}
                aria-label={`${e.facility}: ${htl != null ? `${fmtHours(htl)} to shutdown` : ""}`}
              >
                {e.plan?.recommended.actions.some((a) => a.type === "dispatch_truck") && <TruckGlyph size={15} className="inline-block mr-1.5 align-[-1px] text-ink-2" />}
                {htl != null && <strong style={{ color: htl < 1 ? "var(--shutdown)" : "var(--text-1)" }}>{fmtHours(htl)}</strong>}
                <span className="text-ink-3"> · {e.plan ? (e.plan.recommended.feasible ? "holds" : `trips ${fmtClock(trips ?? now)}`) : ""}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Lane({
  e,
  i,
  laneH,
  x,
  now,
  repairH,
  selected,
  onSelect,
}: {
  e: Event;
  i: number;
  laneH: number;
  x: (t: number) => number;
  now: number;
  repairH: number;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const y = i * laneH;
  const htl = e.hours_to_limit?.p50 ?? 0;
  const shutdownAt = now + htl * 3600; // if nothing is done
  const holds = e.plan?.recommended.feasible ?? false;
  const repairEnd = e.plan?.horizon_end_unix ?? e.onset_unix + repairH * 3600;
  const barEnd = holds ? repairEnd : (e.trips_at_unix ?? shutdownAt);
  const color = holds ? "var(--ok-mark)" : "var(--shutdown)";
  return (
    <g onClick={() => onSelect(e.id)} style={{ cursor: "pointer" }}>
      <rect x={0} y={y} width={100} height={laneH} fill={selected ? "rgb(148 163 196 / 0.07)" : "transparent"} />
      {/* do-nothing shutdown moment: thin red marker */}
      <rect x={x(shutdownAt) - 0.2} y={y + 6} width={0.4} height={laneH - 12} fill="var(--shutdown)" opacity={0.9} />
      {/* repair end */}
      <rect x={x(repairEnd) - 0.15} y={y + 9} width={0.3} height={laneH - 18} fill="var(--text-3)" />
      {/* the plan's bar */}
      <rect x={0} y={y + laneH / 2 - 4} width={Math.max(0.5, x(barEnd))} height={8} rx={0} fill={color} opacity={0.85} />
      {/* amber fill from now while the tank is still filling under the plan (until first truck / shut-in / repair) */}
      <rect x={0} y={y + laneH / 2 - 4} width={Math.max(0.5, Math.min(x(barEnd), x(now + Math.min(htl, 0.75) * 3600)))} height={8} fill="var(--cat-failure-mark)" opacity={0.95} />
    </g>
  );
}
