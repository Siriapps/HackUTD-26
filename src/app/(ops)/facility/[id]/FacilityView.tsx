"use client";

import Link from "next/link";
import { useOps } from "@/store";
import { facilityIndex, facilityLostPerHr, ongoingAt, valueAt } from "@/store/select";
import { CategoryChip, CATEGORY } from "@/components/Category";
import { PlanCompare } from "@/components/PlanCompare";
import { TankGauge } from "@/components/TankGauge";
import { Trend } from "@/components/Trend";
import { Twin3DSlot } from "@/components/Twin3DSlot";
import { fmtClock, fmtHours, fmtMoney, fmtNum, fmtPct, fmtTime } from "@/components/format";
import { describeActions } from "@/lib/export/handoff";

export function FacilityView({ id }: { id: string }) {
  const dataset = useOps((s) => s.dataset);
  const analysis = useOps((s) => s.analysis);
  if (!dataset || !analysis) return null;
  const ref = facilityIndex(dataset).get(id);
  const now = analysis.now;

  if (!ref) {
    return (
      <div className="p-6 text-sm">
        <p className="text-ink-1">
          No facility <span className="num">{id}</span> in <span className="num">{dataset.folder}</span>.
        </p>
        <Link href="/" className="btn mt-3">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const { facility: f, system: sys } = ref;
  const opsF = dataset.ops.systems[sys.id]?.facilities[f.id];
  const { warning, shutdown } = dataset.network.defaults.tank_limits_pct;
  const level = valueAt(dataset, f.tank.id, "level_pct", now);
  const pumpStatus = valueAt(dataset, f.pump.id, "status", now);
  const pumpFlow = valueAt(dataset, f.pump.id, "flow_bpd", now);
  const discharge = valueAt(dataset, f.pump.id, "discharge_psi", now);
  const inflow = valueAt(dataset, f.id, "inflow_bpd", now);
  const receive = valueAt(dataset, f.pipeline.id, "receive_flow_bpd", now);
  const pressure = valueAt(dataset, f.pipeline.id, "pressure_psi", now);
  const events = ongoingAt(analysis, f.id);
  const failure = events.find((e) => e.category === "pump_failure" && e.plan);
  const tone = level >= shutdown ? "shutdown" : failure || level >= warning ? "failure" : "healthy";
  const pumpLabel = pumpStatus === 2 ? "fault" : pumpStatus === 1 ? "running" : pumpStatus === 0 ? "off" : "—";
  const { oil_per_bbl, gas_per_mcf } = dataset.ops.prices;

  return (
    <div className="p-3 space-y-3 max-w-[1600px]">
      <header className="flex items-end justify-between gap-4 flex-wrap px-1">
        <div>
          <Link href="/" className="text-xs text-ink-3 no-underline hover:text-ink-1">
            ← Dashboard
          </Link>
          <h1 className="num text-xl font-semibold leading-tight mt-1 flex items-center gap-3 flex-wrap">
            {f.id}
            {events.map((e) => (
              <CategoryChip key={e.id} category={e.category} />
            ))}
          </h1>
          <p className="text-sm text-ink-2 mt-1">
            System <span className="num text-ink-1">{sys.id}</span> · pipeline to <span className="num text-ink-1">{sys.disposal_site.id}</span> at{" "}
            <span className="num">{sys.disposal_site.pressure_psi} psi</span>
            {opsF && (
              <>
                {" "}
                · trucks arrive in <span className="num">{opsF.response_min} min</span>, round trip <span className="num">{opsF.cycle_min} min</span>
              </>
            )}
          </p>
        </div>
        <div className="text-right text-sm">
          <div className="text-ink-3">
            Readings at <span className="num text-ink-2">{fmtTime(now)}</span>
          </div>
          {failure?.hours_to_limit && (
            <div className="mt-0.5">
              <span className="num-display text-xl" style={{ color: failure.hours_to_limit.p50 < 1 ? "var(--shutdown)" : "var(--text-1)" }}>
                {fmtHours(failure.hours_to_limit.p50)}
              </span>{" "}
              <span className="text-ink-2">
                to shutdown <span className="num text-ink-3">({fmtClock(now + failure.hours_to_limit.p50 * 3600)})</span>
              </span>
            </div>
          )}
        </div>
      </header>

      <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1.2fr)_minmax(260px,0.9fr)] max-[1280px]:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] gap-3">
        <section className="panel px-3 py-2 flex flex-col items-center">
          <div className="flex items-baseline gap-1 self-stretch">
            <span className="text-sm text-ink-2">Tank</span>
            <span className="num text-ink-3 text-xs">{f.tank.id}</span>
          </div>
          <TankGauge level={level} warning={warning} shutdown={shutdown} start={f.pump.start_level_pct} stop={f.pump.stop_level_pct} tone={tone} />
          <div className="num-display text-2xl leading-none" style={{ color: tone === "shutdown" ? "var(--shutdown)" : tone === "failure" ? "var(--cat-failure)" : "var(--text-1)" }}>
            {fmtPct(level)}
          </div>
          <div className="text-xs text-ink-3 mt-1 num">
            {fmtNum((level / 100) * f.tank.capacity_bbl)} of {fmtNum(f.tank.capacity_bbl)} bbl
          </div>
        </section>

        <section className="panel">
          <header className="panel-head">
            <h2 className="panel-title">Readings</h2>
          </header>
          <dl className="kv px-4 py-3">
            <dt>Inflow</dt>
            <dd className="num">{fmtNum(inflow)} bpd</dd>
            <dt>Pump {f.pump.id}</dt>
            <dd>
              <span className={pumpStatus === 2 ? "text-cat-failure font-semibold" : pumpStatus === 1 ? "text-ok" : "text-ink-2"}>{pumpLabel}</span>
            </dd>
            <dt>Pump flow</dt>
            <dd className="num">
              {fmtNum(pumpFlow)} bpd <span className="text-ink-3">of {fmtNum(f.pump.max_flow_bpd)} max</span>
            </dd>
            <dt>Discharge</dt>
            <dd className="num">{fmtNum(discharge)} psi</dd>
            <dt>Received at disposal</dt>
            <dd className="num">{fmtNum(receive)} bpd</dd>
            <dt>Pipeline pressure</dt>
            <dd className="num">
              {fmtNum(pressure)} psi <span className="text-ink-3">of {fmtNum(f.pipeline.max_pressure_psi)} max</span>
            </dd>
            <dt>If shut in</dt>
            <dd className="num">{fmtMoney(facilityLostPerHr(dataset, f))}/h lost</dd>
          </dl>
        </section>

        <section className="panel min-w-0 overflow-auto">
          <header className="panel-head">
            <h2 className="panel-title">Wells</h2>
            <span className="panel-sub num">
              oil {fmtMoney(oil_per_bbl)}/bbl · gas {fmtMoney(gas_per_mcf)}/mcf
            </span>
          </header>
          <table className="data">
            <thead>
              <tr>
                <th>Well</th>
                <th>State</th>
                <th className="n">Water bpd</th>
                <th className="n">Baseline</th>
                <th className="n">Oil bpd</th>
                <th className="n">Gas mcfd</th>
                <th className="n">$/h shut in</th>
              </tr>
            </thead>
            <tbody>
              {f.wells.map((w) => {
                const st = valueAt(dataset, w.id, "status", now);
                return (
                  <tr key={w.id}>
                    <td className="num">{w.id}</td>
                    <td className={st === 1 ? "text-ok" : st === 0 ? "text-shutdown" : "text-ink-3"}>{st === 1 ? "producing" : st === 0 ? "shut in" : "—"}</td>
                    <td className="n num">{fmtNum(valueAt(dataset, w.id, "water_bpd", now))}</td>
                    <td className="n num text-ink-3">{fmtNum(w.baseline_water_bpd)}</td>
                    <td className="n num">{fmtNum(w.oil_bpd)}</td>
                    <td className="n num">{fmtNum(w.gas_mcfd)}</td>
                    <td className="n num">{fmtMoney((w.oil_bpd * oil_per_bbl + w.gas_mcfd * gas_per_mcf) / 24)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="min-h-[220px] max-[1280px]:col-span-3">
          <Twin3DSlot facilityId={f.id} />
        </section>
      </div>

      {failure?.plan ? (
        <section className="panel">
          <header className="panel-head">
            <div>
              <h2 className="panel-title">
                Plan: <span className="num">{describeActions(failure.plan.recommended.actions)}</span> for {fmtMoney(failure.plan.recommended.cost)}
              </h2>
              <span className="panel-sub">
                Cheapest of {failure.plan.alternatives.length + 1} options that the optimiser priced · uses {failure.plan.trucks_used} of {analysis.fleet[sys.id]?.size ?? "?"} {sys.id} trucks
              </span>
            </div>
            <span className="panel-sub num">{failure.id}</span>
          </header>
          <div className="px-4 py-3">
            <PlanCompare event={failure} dataset={dataset} />
          </div>
        </section>
      ) : events.length ? (
        <section className="panel">
          <header className="panel-head">
            <h2 className="panel-title">Field inspection</h2>
            <span className="panel-sub">No countdown: the tank keeps draining</span>
          </header>
          <ul className="px-4 py-3 space-y-2 text-sm">
            {events.map((e) => (
              <li key={e.id}>
                <div className="flex items-center gap-2">
                  <span className="num font-semibold">{e.asset}</span>
                  <CategoryChip category={e.category} compact />
                  <span className="text-ink-3 num">
                    since {fmtTime(e.onset_unix)} · {Math.round(e.confidence * 100)}%
                  </span>
                </div>
                <ul className="mt-1 text-ink-2 space-y-0.5">
                  {e.evidence.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
                <div className="mt-1.5 flex gap-1">
                  <Link href={`/field/${e.id}`} className="btn h-6 text-xs">
                    Open field view
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="panel px-4 py-3 text-sm text-ink-2">
          Nothing to plan: no problem in progress at this facility. {CATEGORY.pump_failure.label}s get a priced plan here; leaks and worn pumps get an inspection.
        </section>
      )}

      <Trend dataset={dataset} analysis={analysis} now={now} facilityId={f.id} />
    </div>
  );
}
