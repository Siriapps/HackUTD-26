"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import type { Dataset, Event, PlanOption } from "@/lib/data/types";
import { facilityIndex } from "@/store/select";
import { fmtClock, fmtMoney, fmtPct } from "./format";

/**
 * Projected tank level under every option the optimiser considered. The recommended plan is the bright line;
 * feasible alternatives are grey, options that still trip are red. Hover a row to lift its curve.
 */
export function PlanCompare({ event, dataset }: { event: Event; dataset: Dataset }) {
  const plan = event.plan!;
  const [hover, setHover] = useState<string | null>(null);
  const options = useMemo(() => [plan.recommended, ...plan.alternatives], [plan]);
  const { warning, shutdown } = dataset.network.defaults.tank_limits_pct;
  const { data, start, yMin } = useMemo(() => merge(options), [options]);
  const end = plan.horizon_end_unix;
  const ref = facilityIndex(dataset).get(event.facility);
  const opsF = ref ? dataset.ops.systems[ref.system.id]?.facilities[event.facility] : undefined;

  // Truck arrival ticks for the recommended plan: called at plan start, first arrival response_min later, then every cycle_min.
  const arrivals: number[] = [];
  if (opsF) {
    for (const a of plan.recommended.actions) {
      if (a.type !== "dispatch_truck") continue;
      for (let k = 0; k < a.trips_per_truck; k++) {
        const at = start + (opsF.response_min + k * opsF.cycle_min) * 60;
        if (at <= end) arrivals.push(at);
      }
    }
  }
  const ticks: number[] = [];
  for (let t = Math.ceil(start / 3600) * 3600; t <= end; t += 3600) ticks.push(t);

  const color = (i: number, o: PlanOption) => (i === 0 ? "var(--accent)" : o.feasible ? "var(--text-3)" : "var(--shutdown)");
  const rec = plan.recommended;
  const peakPt = rec.curve.reduce((m, p) => (p.level_pct > m.level_pct ? p : m), rec.curve[0]);
  const cheaperUnavailable = plan.alternatives.find((o) => o.cost < rec.cost);
  const fleetLine = event.evidence.find((l) => /trucks? (free|allocated|used)/.test(l));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_320px] max-[1100px]:grid-cols-1 gap-4">
      <div className="min-w-0">
        {/* The why, in one sentence, from the numbers on hand. */}
        <p className="mb-2 text-sm text-ink-2 leading-relaxed">
          {rec.feasible ? (
            <>
              <span className="text-ink-1 font-medium">{rec.label}</span> holds the tank at a peak of <span className="num text-ink-1">{fmtPct(peakPt.level_pct)}</span>
              {peakPt.level_pct >= shutdown - 0.5 ? " (at the limit, not over)" : ""} until repair ends at <span className="num">{fmtClock(end)}</span>, for{" "}
              <span className="num text-ink-1 font-semibold">{fmtMoney(rec.cost)}</span>.
              {fleetLine ? ` ${fleetLine}.` : ""}
              {cheaperUnavailable ? ` ${cheaperUnavailable.label} would be ${fmtMoney(cheaperUnavailable.cost)} if its trucks were free.` : ""}
            </>
          ) : (
            <>
              No option keeps this tank under <span className="num">{shutdown}%</span>; the cheapest outcome is to <span className="text-ink-1 font-medium">{rec.label.toLowerCase()}</span> for{" "}
              <span className="num text-ink-1 font-semibold">{fmtMoney(rec.cost)}</span>.
            </>
          )}
        </p>
      <div className="h-[300px] min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 104, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--line-1)" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              domain={[start, end]}
              ticks={ticks}
              tickFormatter={(v: number) => fmtClock(v)}
              stroke="var(--line-2)"
              tick={{ fill: "var(--text-3)", fontSize: 11, fontFamily: "var(--font-mono)" }}
              tickLine={false}
            />
            <YAxis
              domain={[yMin, 100]}
              width={40}
              tickFormatter={(v: number) => `${v}%`}
              stroke="transparent"
              tick={{ fill: "var(--text-3)", fontSize: 11, fontFamily: "var(--font-mono)" }}
              tickLine={false}
            />
            <ReferenceLine y={shutdown} stroke="var(--shutdown)" strokeWidth={1} label={{ value: `shutdown ${shutdown}%`, position: "insideTopRight", fill: "var(--shutdown)", fontSize: 11 }} />
            <ReferenceLine y={warning} stroke="var(--warn)" strokeDasharray="4 4" label={{ value: `warning ${warning}%`, position: "insideTopRight", fill: "var(--warn)", fontSize: 11 }} />
            <ReferenceLine x={end} stroke="var(--text-3)" label={{ value: `repair ends ${fmtClock(end)}`, position: "right", fill: "var(--text-2)", fontSize: 11 }} />
            {rec.feasible && peakPt && (
              <ReferenceDot x={peakPt.t_unix} y={peakPt.level_pct} r={4} fill="var(--accent)" stroke="var(--surface-1)" strokeWidth={2} label={{ value: `peak ${fmtPct(peakPt.level_pct)}`, position: "top", fill: "var(--text-1)", fontSize: 11 }} />
            )}
            {arrivals.map((at) => (
              <ReferenceLine
                key={at}
                segment={[
                  { x: at, y: yMin },
                  { x: at, y: yMin + 6 },
                ]}
                stroke="var(--accent)"
                strokeWidth={2}
              />
            ))}
            <Tooltip
              cursor={{ stroke: "var(--line-2)" }}
              content={(p: TooltipContentProps) => <Tip {...p} options={options} />}
            />
            {options.map((o, i) => (
              <Line
                key={o.label}
                dataKey={`o${i}`}
                name={o.label}
                type="monotone"
                stroke={color(i, o)}
                strokeWidth={i === 0 ? 2.5 : 1.5}
                strokeOpacity={hover == null || hover === o.label ? 1 : 0.25}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface-1)" }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <p className="mt-1 text-xs text-ink-3 pl-10">
          {arrivals.length ? "Short ticks mark truck arrivals. " : ""}Plan starts {fmtClock(start)}, horizon is the repair end.
        </p>
      </div>
      </div>

      <ol className="text-sm self-start" onMouseLeave={() => setHover(null)}>
        {options.map((o, i) => (
          <li
            key={o.label}
            onMouseEnter={() => setHover(o.label)}
            onFocus={() => setHover(o.label)}
            tabIndex={0}
            className={`grid grid-cols-[18px_minmax(0,1fr)_auto] gap-x-2 py-2 border-b border-line-1 rounded-sm ${hover === o.label ? "bg-surface-2" : ""} ${i === 0 ? "text-ink-1" : "text-ink-2"}`}
          >
            <span className="mt-2 h-0.5 rounded" style={{ background: color(i, o), width: 14 }} aria-hidden />
            <span className="min-w-0">
              <span className="block leading-snug">{o.label}</span>
              <span className="block text-xs num">
                <span className={o.feasible ? "text-ok" : "text-shutdown"} style={{ color: o.feasible ? "var(--ok)" : "var(--shutdown)" }}>
                  {o.feasible ? "holds" : "trips"}
                </span>
                <span className="text-ink-3">
                  {" "}
                  · {o.feasible ? `peak ${fmtPct(o.peak_level_pct)}` : `at ${o.trips_at_unix ? fmtClock(o.trips_at_unix) : "—"}`}
                  {i === 0 ? " · recommended" : ""}
                </span>
              </span>
            </span>
            <span className={`num ${i === 0 ? "font-semibold" : ""}`}>{fmtMoney(o.cost)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Tip({ active, payload, label, options }: TooltipContentProps & { options: PlanOption[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <div className="num text-ink-3 mb-1">{fmtClock(Number(label))}</div>
      {payload.map((p) => {
        const i = Number(String(p.dataKey).slice(1));
        const o = options[i];
        return (
          <div key={String(p.dataKey)} className="grid grid-cols-[14px_auto_minmax(0,1fr)] gap-x-2 items-center">
            <span className="h-0.5 w-3.5 rounded" style={{ background: p.color }} />
            <span className="num font-semibold text-ink-1">{fmtPct(Number(p.value))}</span>
            <span className="text-ink-2 truncate max-w-[220px]">{o?.label ?? p.name}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Union of every option's time grid → one row per t with o0..oN columns, so the tooltip reads all curves at once. */
function merge(options: PlanOption[]) {
  const rows = new Map<number, Record<string, number>>();
  let yMin = 100;
  options.forEach((o, i) => {
    for (const pt of o.curve) {
      const row = rows.get(pt.t_unix) ?? { t: pt.t_unix };
      row[`o${i}`] = pt.level_pct;
      rows.set(pt.t_unix, row);
      if (pt.level_pct < yMin) yMin = pt.level_pct;
    }
  });
  const data = [...rows.values()].sort((a, b) => a.t - b.t);
  return { data, start: data[0]?.t ?? 0, yMin: Math.max(0, Math.floor((yMin - 8) / 10) * 10) };
}
