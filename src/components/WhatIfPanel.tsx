"use client";

import { useMemo, useState } from "react";
import { useOps } from "@/store";
import { whatIf } from "@/lib/forecast/whatif";
import { describeActions } from "@/lib/export/handoff";
import { fmtHours, fmtMoney } from "./format";
import { INFO, InfoTip } from "./InfoTip";

/**
 * What-if simulator. Fill rates are the physics everyone can check by hand:
 * pct/h = inflow bpd ÷ 24 ÷ capacity × 100. Then stress the system: one more pump fails,
 * one truck fewer, the disposal site goes down. The optimiser re-plans jointly; the cost shows.
 */
export function WhatIfPanel() {
  const dataset = useOps((s) => s.dataset);
  const analysis = useOps((s) => s.analysis);
  const [system, setSystem] = useState<string>("");
  const [extra, setExtra] = useState<string[]>([]);
  const [fleetDelta, setFleetDelta] = useState(0);
  const [disposalDown, setDisposalDown] = useState(false);
  const sysId = system || dataset?.network.systems[0]?.id || "";
  const sys = dataset?.network.systems.find((s) => s.id === sysId);

  const base = useMemo(() => (dataset && analysis && sysId ? whatIf(dataset, analysis, { system: sysId }) : null), [dataset, analysis, sysId]);
  const res = useMemo(() => (dataset && analysis && sysId ? whatIf(dataset, analysis, { system: sysId, extraFailures: extra, fleetDelta, disposalDown }) : null), [dataset, analysis, sysId, extra, fleetDelta, disposalDown]);
  if (!dataset || !analysis || !sys || !base || !res) return null;
  const ongoing = new Set(analysis.alerts.filter((e) => e.category === "pump_failure" && e.system === sysId).map((e) => e.facility));
  const limits = dataset.network.defaults.tank_limits_pct;

  return (
    <section className="panel" aria-labelledby="whatif-h">
      <header className="panel-head">
        <h2 id="whatif-h" className="panel-title flex items-center gap-1.5">
          What if <InfoTip title="What-if simulator">{"Re-plans one system right now under a scenario you choose. Fill rate is inflow ÷ 24 ÷ tank capacity × 100 (pct per hour); hours to shutdown is the gap to the limit divided by that rate. Costs come from the same minute-by-minute optimiser as the live plans, with trucks shared across the system."}</InfoTip>
        </h2>
        <select className="select num" value={sysId} onChange={(e) => { setSystem(e.target.value); setExtra([]); }} aria-label="System">
          {dataset.network.systems.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id}
            </option>
          ))}
        </select>
      </header>

      <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] max-[1100px]:grid-cols-1 gap-x-8 gap-y-4 px-4 py-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-ink-3 mb-2">Fill rates in {sys.id}</p>
          <table className="w-full text-sm">
            <thead className="text-ink-3 text-xs">
              <tr>
                <th className="text-left font-medium py-1">Facility</th>
                <th className="text-right font-medium">Tank</th>
                <th className="text-right font-medium">Inflow</th>
                <th className="text-right font-medium">Fill rate</th>
                <th className="text-right font-medium">Empty→shutdown</th>
                <th className="text-right font-medium">Fails now?</th>
              </tr>
            </thead>
            <tbody>
              {sys.facilities.map((f) => {
                const inflow = f.wells.reduce((s, w) => s + w.baseline_water_bpd, 0);
                const rate = (inflow / 24 / f.tank.capacity_bbl) * 100;
                const on = extra.includes(f.id) || disposalDown;
                return (
                  <tr key={f.id} className="border-t border-line-1">
                    <td className="py-1.5 num text-ink-1">{f.id}</td>
                    <td className="text-right num">{f.tank.capacity_bbl} bbl</td>
                    <td className="text-right num">{inflow.toLocaleString("en-US")} bpd</td>
                    <td className="text-right num text-ink-1">{rate.toFixed(1)} %/h</td>
                    <td className="text-right num">{fmtHours(limits.shutdown / rate)}</td>
                    <td className="text-right">
                      {ongoing.has(f.id) ? (
                        <span className="text-xs" style={{ color: "var(--cat-failure)" }}>
                          failed
                        </span>
                      ) : (
                        <input type="checkbox" checked={on} disabled={disposalDown} onChange={(e) => setExtra((x) => (e.target.checked ? [...x, f.id] : x.filter((i) => i !== f.id)))} aria-label={`Fail ${f.id} now`} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-3 flex items-center gap-4 flex-wrap text-sm">
            <label className="flex items-center gap-2">
              Trucks in {sys.id}:
              <button type="button" className="btn h-7" onClick={() => setFleetDelta((d) => d - 1)} aria-label="One truck fewer">
                −
              </button>
              <span className="num text-ink-1 w-10 text-center">{res.fleet}</span>
              <button type="button" className="btn h-7" onClick={() => setFleetDelta((d) => d + 1)} aria-label="One truck more">
                +
              </button>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={disposalDown} onChange={(e) => setDisposalDown(e.target.checked)} /> Disposal site down (every pump stops)
            </label>
            {(extra.length || fleetDelta || disposalDown) && (
              <button type="button" className="btn h-7" onClick={() => { setExtra([]); setFleetDelta(0); setDisposalDown(false); }}>
                Reset
              </button>
            )}
          </div>
        </div>

        <div>
          <p className="text-xs uppercase tracking-wide text-ink-3 mb-2">Outcome under this scenario</p>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="num text-3xl font-semibold" style={{ color: res.total_cost > base.total_cost ? "var(--shutdown)" : "var(--text-1)" }}>
              {fmtMoney(res.total_cost)}
            </span>
            <span className="text-sm text-ink-2">
              total · now {fmtMoney(base.total_cost)} · trucks committed <span className="num text-ink-1">{res.committed}</span> of <span className="num">{res.fleet}</span>
            </span>
          </div>
          <ol className="mt-3 space-y-2 text-sm">
            {res.facilities.length === 0 && <li className="text-ink-3">No pump failures in {sys.id} under this scenario.</li>}
            {res.facilities.map((f) => (
              <li key={f.facility} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-t border-line-1 pt-2">
                <span>
                  <span className="num text-ink-1">{f.facility}</span>
                  {f.hypothetical && <span className="ml-2 text-xs text-ink-3">hypothetical</span>}
                  <span className="block text-ink-2">{describeActions(f.plan.recommended.actions)}</span>
                  <span className="block text-xs" style={{ color: f.plan.recommended.feasible ? "var(--ok)" : "var(--shutdown)" }}>
                    {f.plan.recommended.feasible ? `holds · peak ${f.plan.recommended.peak_level_pct.toFixed(1)} %` : "trips"}
                  </span>
                </span>
                <span className="num font-semibold" style={{ color: f.plan.recommended.feasible ? "var(--ok)" : "var(--shutdown)" }}>
                  {fmtMoney(f.plan.recommended.cost)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
