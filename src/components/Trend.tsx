"use client";

import { Fragment, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import type { Analysis, Dataset, Metric } from "@/lib/data/types";
import { UNIT, eventsFor, facilityAssets, facilityIndex, seriesWindow, type FacilityRef } from "@/store/select";
import { CATEGORY } from "./Category";
import { fmtClock, fmtDay, fmtNum, fmtTime } from "./format";

/** A series is named by role so the same pick maps onto another facility for side-by-side comparison. */
interface Spec {
  kind: string;
  index: number;
  metric: Metric;
}
const DEFAULT: Spec[] = [
  { kind: "tank", index: 0, metric: "level_pct" },
  { kind: "pump", index: 0, metric: "status" },
  { kind: "pump", index: 0, metric: "flow_bpd" },
];
const WINDOWS: { label: string; hours: number | null }[] = [
  { label: "6 h", hours: 6 },
  { label: "24 h", hours: 24 },
  { label: "3 d", hours: 72 },
  { label: "All", hours: null },
];

export function Trend({ dataset, analysis, now, facilityId }: { dataset: Dataset; analysis: Analysis | null; now: number; facilityId: string }) {
  const index = facilityIndex(dataset);
  const ref = index.get(facilityId);
  const [specs, setSpecs] = useState<Spec[]>(DEFAULT);
  const [win, setWin] = useState<number | null>(24);
  const [compare, setCompare] = useState<string>("");
  const [pickAsset, setPickAsset] = useState(0);
  const [pickMetric, setPickMetric] = useState(0);
  if (!ref) return null;
  const assets = facilityAssets(ref);
  const cmpRef = compare ? index.get(compare) : undefined;
  const columns: FacilityRef[] = cmpRef ? [ref, cmpRef] : [ref];
  const from = win == null ? dataset.ts[0] : Math.max(dataset.ts[0], now - win * 3600);
  const metricsOfPick = assets[pickAsset]?.metrics ?? [];

  function add() {
    const a = assets[pickAsset];
    const m = metricsOfPick[pickMetric];
    if (!a || !m) return;
    const spec: Spec = { kind: a.kind, index: a.kind === "well" ? ref!.facility.wells.findIndex((w) => w.id === a.id) : 0, metric: m };
    if (specs.some((s) => s.kind === spec.kind && s.index === spec.index && s.metric === spec.metric)) return;
    setSpecs([...specs, spec]);
  }

  return (
    <section className="panel">
      <header className="panel-head flex-wrap gap-y-2">
        <div>
          <h2 className="panel-title">Sensor trends</h2>
          <span className="panel-sub">Any metric, any asset; event spans shaded</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select className="select num" value={pickAsset} onChange={(e) => { setPickAsset(+e.target.value); setPickMetric(0); }} aria-label="Asset">
            {assets.map((a, i) => (
              <option key={a.id} value={i}>
                {a.id}
              </option>
            ))}
          </select>
          <select className="select num" value={pickMetric} onChange={(e) => setPickMetric(+e.target.value)} aria-label="Metric">
            {metricsOfPick.map((m, i) => (
              <option key={m} value={i}>
                {m}
              </option>
            ))}
          </select>
          <button type="button" className="btn" onClick={add}>
            Add series
          </button>
          <span className="w-px h-5 bg-line mx-1" aria-hidden />
          <div className="flex rounded-md border border-line-1-2 overflow-hidden" role="group" aria-label="Window">
            {WINDOWS.map((w) => (
              <button
                key={w.label}
                type="button"
                className={`h-[26px] px-2.5 text-xs ${win === w.hours ? "bg-surface-3 text-ink-1" : "text-ink-2 hover:bg-surface-2"}`}
                onClick={() => setWin(w.hours)}
                aria-pressed={win === w.hours}
              >
                {w.label}
              </button>
            ))}
          </div>
          <select className="select num" value={compare} onChange={(e) => setCompare(e.target.value)} aria-label="Compare with facility">
            <option value="">Compare with…</option>
            {[...index.keys()]
              .filter((id) => id !== facilityId)
              .map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
          </select>
        </div>
      </header>

      <div className={`grid gap-x-4 px-2 py-2 ${columns.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
        {columns.map((col) => (
          <div key={col.facility.id} className="num text-sm text-ink-1 px-2 pt-1">
            {col.facility.id}
          </div>
        ))}
        {specs.map((spec, row) => (
          <Fragment key={`${spec.kind}-${spec.index}-${spec.metric}`}>
            {columns.map((col, ci) => {
              const asset = resolve(col, spec);
              const last = row === specs.length - 1;
              const pts = asset ? seriesWindow(dataset, asset, spec.metric, from, now) : [];
              const spans = eventsFor(analysis, col.facility.id).filter((e) => (e.end_unix ?? now) >= from && e.onset_unix <= now);
              const domain: [number | "auto", number | "auto"] = spec.metric === "level_pct" ? [0, 100] : spec.metric === "status" ? [0, 2] : ["auto", "auto"];
              return (
                <div key={col.facility.id} className="min-w-0">
                  <div className="flex items-baseline justify-between px-2 pt-2">
                    <span className="text-xs text-ink-2">
                      <span className="num text-ink-1">{asset ?? "—"}</span> · {spec.metric}
                      {UNIT[spec.metric] ? ` (${UNIT[spec.metric]})` : ""}
                    </span>
                    {ci === 0 && specs.length > 1 && (
                      <button type="button" className="btn btn-quiet h-5 text-xs" onClick={() => setSpecs(specs.filter((_, i) => i !== row))} aria-label={`Remove ${spec.metric}`}>
                        Remove
                      </button>
                    )}
                  </div>
                  <div style={{ height: last ? 130 : 110 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={pts} syncId="trend" margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                        <CartesianGrid stroke="var(--line-1)" vertical={false} />
                        {spans.map((e) => (
                          <ReferenceArea
                            key={e.id}
                            x1={Math.max(from, e.onset_unix)}
                            x2={Math.min(now, e.end_unix ?? now)}
                            fill={CATEGORY[e.category].mark}
                            fillOpacity={0.14}
                            stroke={CATEGORY[e.category].mark}
                            strokeOpacity={0.5}
                            ifOverflow="extendDomain"
                          />
                        ))}
                        <XAxis
                          dataKey="t"
                          type="number"
                          domain={[from, now]}
                          hide={!last}
                          height={20}
                          tickFormatter={(v: number) => (win != null && win <= 72 ? fmtClock(v) : fmtDay(v))}
                          stroke="var(--line-2)"
                          tick={{ fill: "var(--text-3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                          tickLine={false}
                          tickCount={6}
                        />
                        <YAxis domain={domain} width={46} tickCount={3} tickFormatter={(v: number) => compact(v)} stroke="transparent" tick={{ fill: "var(--text-3)", fontSize: 10, fontFamily: "var(--font-mono)" }} tickLine={false} />
                        <Tooltip cursor={{ stroke: "var(--line-2)" }} content={(p: TooltipContentProps) => <Tip {...p} unit={UNIT[spec.metric]} />} />
                        <Line
                          dataKey="v"
                          type={spec.metric === "status" ? "stepAfter" : "linear"}
                          stroke={ci === 0 ? "var(--accent)" : "var(--text-2)"}
                          strokeWidth={1.5}
                          dot={false}
                          activeDot={{ r: 3, strokeWidth: 2, stroke: "var(--surface-1)" }}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </section>
  );
}

function resolve(ref: FacilityRef, spec: Spec): string | null {
  const f = ref.facility;
  switch (spec.kind) {
    case "facility":
      return f.id;
    case "tank":
      return f.tank.id;
    case "pump":
      return f.pump.id;
    case "pipeline":
      return f.pipeline.id;
    case "well":
      return f.wells[spec.index]?.id ?? null;
    default:
      return null;
  }
}

const compact = (v: number) => (Math.abs(v) >= 10000 ? `${Math.round(v / 1000)}k` : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v * 10) / 10}`);

function Tip({ active, payload, label, unit }: TooltipContentProps & { unit: string }) {
  if (!active || !payload?.length) return null;
  const v = Number(payload[0].value);
  return (
    <div className="chart-tip">
      <span className="num font-semibold text-ink-1">
        {fmtNum(v, Number.isInteger(v) ? 0 : 1)}
        {unit ? ` ${unit}` : ""}
      </span>
      <span className="num text-ink-3 ml-2">{fmtTime(Number(label))}</span>
    </div>
  );
}
