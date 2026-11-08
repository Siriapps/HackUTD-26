"use client";

import Link from "next/link";
import { useOps } from "@/store";
import { actualOutcome } from "@/store/outcome";
import { Alerts } from "@/components/Alerts";
import { CategoryChip } from "@/components/Category";
import { EventStrip } from "@/components/EventStrip";
import { FleetCard } from "@/components/FleetCard";
import { TimeScrubber } from "@/components/TimeScrubber";
import { fmtClock, fmtHours, fmtMoney, fmtPct, fmtTime } from "@/components/format";
import { planLine } from "@/lib/export/handoff";

/** Scrub "now" across the telemetry: what the console would have said then, beside what the data says happened. */
export default function TimelinePage() {
  const dataset = useOps((s) => s.dataset);
  const analysis = useOps((s) => s.analysis);
  const full = useOps((s) => s.fullAnalysis);
  const setNow = useOps((s) => s.setNow);
  if (!dataset || !analysis || !full) return null;
  const now = analysis.now;
  const { shutdown } = dataset.network.defaults.tank_limits_pct;

  return (
    <div className="p-3 space-y-3 max-w-[1600px]">
      <section className="panel">
        <TimeScrubber full />
        <EventStrip dataset={dataset} full={full} now={now} onPick={(t) => setNow(t)} />
      </section>

      <div className="grid grid-cols-2 max-[1100px]:grid-cols-1 gap-3 items-start">
        <section className="panel flex flex-col min-h-0">
          <header className="panel-head">
            <h2 className="panel-title">What we would have said</h2>
            <span className="panel-sub num">at {fmtTime(now)}</span>
          </header>
          <Alerts compact />
          <div className="border-t border-line-1">
            <FleetCard />
          </div>
        </section>

        <section className="panel">
          <header className="panel-head">
            <h2 className="panel-title">What actually happened</h2>
            <span className="panel-sub">from the telemetry after each onset</span>
          </header>
          {analysis.alerts.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-3">Nothing was in progress at this moment. Click an event bar above to jump to it.</p>
          ) : (
            <ul className="divide-y divide-line-1">
              {analysis.alerts.map((e) => {
                const hind = full.events.find((x) => x.id === e.id) ?? e;
                const o = actualOutcome(dataset, hind);
                const said = e.hours_to_limit?.p50;
                const tripped = o.peak_pct != null && o.peak_pct >= shutdown - 0.05;
                return (
                  <li key={e.id} className="px-4 py-3 text-sm">
                    <div className="flex items-center gap-2">
                      <Link href={`/facility/${e.facility}`} className="num font-semibold hover:underline">
                        {e.facility}
                      </Link>
                      <CategoryChip category={e.category} compact />
                      <span className="num text-xs text-ink-3 ml-auto">{e.id}</span>
                    </div>
                    <dl className="kv mt-2">
                      <dt>We said</dt>
                      <dd>
                        {said != null ? (
                          <>
                            shutdown in <span className="num">{fmtHours(said)}</span> ({fmtClock(now + said * 3600)}) · {planLine(e)}
                          </>
                        ) : (
                          planLine(e)
                        )}
                      </dd>
                      <dt>Happened</dt>
                      <dd>
                        {e.category === "pump_failure" ? (
                          <>
                            {o.peak_pct != null ? (
                              <>
                                tank peaked at <span className={`num ${tripped ? "text-shutdown" : "text-ink-1"}`}>{fmtPct(o.peak_pct)}</span>
                                {o.peak_at != null && (
                                  <>
                                    {" "}
                                    at <span className="num">{fmtClock(o.peak_at)}</span>
                                  </>
                                )}
                              </>
                            ) : (
                              "no level data yet"
                            )}
                            {o.shut_in_at != null ? (
                              <>
                                ; wells shut in <span className="num">{fmtClock(o.shut_in_at)}</span>
                                {o.resumed_at != null && (
                                  <>
                                    , resumed <span className="num">{fmtClock(o.resumed_at)}</span>
                                  </>
                                )}
                              </>
                            ) : o.truncated ? (
                              "; still running when the data ends"
                            ) : (
                              "; never tripped"
                            )}
                            {hind.end_unix != null && (
                              <>
                                ; repaired <span className="num">{fmtClock(hind.end_unix)}</span>
                              </>
                            )}
                          </>
                        ) : hind.end_unix != null ? (
                          <>
                            cleared <span className="num">{fmtTime(hind.end_unix)}</span> after {fmtHours((hind.end_unix - hind.onset_unix) / 3600)}
                          </>
                        ) : (
                          "still open when the data ends"
                        )}
                      </dd>
                      {hind.plan && hind.plan.alternatives.length > 0 && (
                        <>
                          <dt>Doing nothing</dt>
                          <dd className="num">{fmtMoney(hind.plan.alternatives[hind.plan.alternatives.length - 1].cost)}</dd>
                        </>
                      )}
                    </dl>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
