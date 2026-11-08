"use client";

import { useEffect, useMemo, useState } from "react";
import { useOps } from "@/store";
import { CATEGORY } from "@/components/Category";
import { INFO, InfoTip } from "@/components/InfoTip";
import { fmtHours, fmtMoney } from "@/components/format";
import type { Category, Event } from "@/lib/data/types";

interface Thread {
  eventId: string;
  folder: string;
  status: "awaiting" | "approved" | "rejected" | "resolved" | "escalated";
  sentAt?: number;
  ackAt?: number;
  decidedAt?: number;
  log: { at: number; dir: "in" | "out" }[];
}
interface DbIncident {
  event_id: string;
  dataset: string;
  category: string;
  verdict: string | null;
  resolution: string | null;
  messages: number;
}

const CATS: Category[] = ["pump_failure", "pipeline_leak", "pump_degradation"];
const dayKey = (t: number) => new Date(t * 1000).toISOString().slice(5, 10);

/** Admin analytics: how often things fail, how long between, what the plans saved, how the humans responded. */
export default function AdminPage() {
  const dataset = useOps((s) => s.dataset);
  const analysis = useOps((s) => s.analysis);
  const full = useOps((s) => s.fullAnalysis);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [db, setDb] = useState<{ connected: boolean; incidents: DbIncident[] } | null>(null);
  useEffect(() => {
    void fetch("/api/dispatch/state", { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])).then(setThreads).catch(() => {});
    void fetch("/api/db/incidents", { cache: "no-store" }).then((r) => r.json()).then(setDb).catch(() => setDb({ connected: false, incidents: [] }));
  }, [dataset?.folder]);

  const events = useMemo(() => (full ?? analysis)?.events ?? [], [full, analysis]);
  const stats = useMemo(() => build(events, dataset?.network.systems.map((s) => s.id) ?? []), [events, dataset]);
  if (!dataset || !analysis) return null;
  const mine = threads.filter((t) => t.folder === dataset.folder);
  const answered = mine.filter((t) => t.ackAt || t.decidedAt || t.log.some((l) => l.dir === "in"));
  const approved = mine.filter((t) => t.status === "approved" || t.status === "resolved");
  const medianAck = median(mine.filter((t) => t.sentAt && (t.ackAt ?? t.decidedAt)).map((t) => ((t.ackAt ?? t.decidedAt)! - t.sentAt!) / 60000));

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1500px]">
      <header>
        <h1 className="text-2xl">Analytics</h1>
        <p className="text-sm text-ink-2 mt-1">
          {dataset.folder} · {events.length} events over {stats.days.length} days · everything below is derived from the same analysis the board runs, plus what the dispatch engine and Tiger Data remember.
        </p>
      </header>

      <section className="grid grid-cols-4 max-[1100px]:grid-cols-2 gap-3">
        <Kpi label="Cost avoided vs doing nothing" value={fmtMoney(stats.avoided)} sub={`${stats.failures} pump failures · recommended plans ${fmtMoney(stats.recommended)}`} tone="ok" />
        <Kpi label="Mean time between pump failures" value={stats.mtbfH != null ? fmtHours(stats.mtbfH) : "—"} sub="across the network, onset to onset" />
        <Kpi label="Texts answered" value={mine.length ? `${Math.round((answered.length / mine.length) * 100)} %` : "—"} sub={`${answered.length} of ${mine.length} threads · median first reply ${medianAck != null ? `${Math.round(medianAck)} min` : "—"}`} />
        <Kpi label="Plans approved as recommended" value={mine.length ? `${Math.round((approved.length / mine.length) * 100)} %` : "—"} sub={`${approved.length} approved · ${mine.filter((t) => t.status === "escalated").length} escalated`} tone={approved.length ? "ok" : undefined} />
      </section>

      <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] max-[1100px]:grid-cols-1 gap-3">
        <section className="panel">
          <header className="panel-head">
            <h2 className="panel-title flex items-center gap-1.5">
              Events per day <InfoTip title="Events per day">{"Count of event onsets per UTC day, split by category. Pump failures in tangerine, leaks in teal, worn pumps in olive."}</InfoTip>
            </h2>
          </header>
          <div className="px-4 py-4">
            <Bars days={stats.days} />
          </div>
        </section>

        <section className="panel">
          <header className="panel-head">
            <h2 className="panel-title flex items-center gap-1.5">
              By system <InfoTip title="By system">{"Where the problems are. Fleet utilisation is trucks the recommended plans used over the fleet size, summed across failures."}</InfoTip>
            </h2>
          </header>
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-3">
              <tr>
                <th className="text-left font-medium px-4 py-2">System</th>
                <th className="text-right font-medium">Failures</th>
                <th className="text-right font-medium">Leaks</th>
                <th className="text-right font-medium">Wear</th>
                <th className="text-right font-medium">Truck-trips</th>
                <th className="text-right font-medium pr-4">Plan cost</th>
              </tr>
            </thead>
            <tbody>
              {stats.bySystem.map((r) => (
                <tr key={r.id} className="border-t border-line-1">
                  <td className="num px-4 py-1.5 text-ink-1">{r.id}</td>
                  <td className="num text-right">{r.failures}</td>
                  <td className="num text-right">{r.leaks}</td>
                  <td className="num text-right">{r.wear}</td>
                  <td className="num text-right">{r.trips}</td>
                  <td className="num text-right pr-4">{fmtMoney(r.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] max-[1100px]:grid-cols-1 gap-3">
        <section className="panel">
          <header className="panel-head">
            <h2 className="panel-title flex items-center gap-1.5">
              Cost of each failure <InfoTip title={INFO.plan.title}>{"Recommended plan vs the cost of doing nothing (production lost while the wells sit shut in until repair). The gap is what the console saves per failure."}</InfoTip>
            </h2>
          </header>
          <ul className="divide-y divide-line-1">
            {stats.perFailure.map((f) => (
              <li key={f.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-4 items-center px-4 py-2 text-sm">
                <span>
                  <span className="num text-ink-1">{f.facility}</span>
                  <span className="block text-xs text-ink-3">{f.label}</span>
                </span>
                <span className="num text-right" style={{ color: "var(--shutdown)" }}>
                  {fmtMoney(f.nothing)}
                </span>
                <span className="num text-right font-semibold" style={{ color: "var(--ok)" }}>
                  {fmtMoney(f.cost)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <header className="panel-head">
            <h2 className="panel-title flex items-center gap-1.5">
              Remembered in Tiger Data <InfoTip title="Tiger Data">{"Incidents the database holds across every machine: texted alerts with their plans, technician verdicts and resolutions, message counts. Empty until an alert is texted or closed out."}</InfoTip>
            </h2>
            <span className="panel-sub">{db ? (db.connected ? `${db.incidents.length} incidents` : "not connected") : "…"}</span>
          </header>
          {db?.incidents.length ? (
            <ul className="divide-y divide-line-1 max-h-[360px] overflow-auto">
              {db.incidents.map((i) => (
                <li key={`${i.dataset}|${i.event_id}`} className="px-4 py-2 text-sm grid grid-cols-[minmax(0,1fr)_auto] gap-x-3">
                  <span>
                    <span className="num text-ink-1">{i.event_id}</span> <span className="text-ink-3">· {i.dataset}</span>
                    <span className="block text-xs text-ink-2">
                      {CATEGORY[i.category as Category]?.label ?? i.category}
                      {i.verdict ? ` · ${i.verdict}` : ""}
                      {i.resolution ? ` · “${i.resolution}”` : ""}
                    </span>
                  </span>
                  <span className="num text-xs text-ink-3">{i.messages} msg</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-4 text-sm text-ink-3">{db?.connected ? "Nothing yet. Text an alert or close one out and it appears here." : "Set DATABASE_URL to persist incidents across machines."}</p>
          )}
        </section>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "bad" }) {
  return (
    <div className="panel px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-ink-3">{label}</p>
      <p className="num text-2xl font-semibold mt-1" style={{ color: tone === "ok" ? "var(--ok)" : tone === "bad" ? "var(--shutdown)" : "var(--text-1)" }}>
        {value}
      </p>
      {sub && <p className="text-xs text-ink-3 mt-1">{sub}</p>}
    </div>
  );
}

function Bars({ days }: { days: { day: string; counts: Record<Category, number> }[] }) {
  const max = Math.max(1, ...days.map((d) => CATS.reduce((s, c) => s + d.counts[c], 0)));
  return (
    <div className="flex items-end gap-3 h-[180px]" role="img" aria-label="Events per day">
      {days.map((d) => (
        <div key={d.day} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
          <div className="w-full flex flex-col-reverse" style={{ height: `${(CATS.reduce((s, c) => s + d.counts[c], 0) / max) * 150}px` }}>
            {CATS.map((c) =>
              d.counts[c] ? (
                <div key={c} title={`${CATEGORY[c].label}: ${d.counts[c]}`} style={{ flex: d.counts[c], background: CATEGORY[c].mark }} />
              ) : null,
            )}
          </div>
          <span className="num text-xs text-ink-3">{d.day}</span>
        </div>
      ))}
    </div>
  );
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

function build(events: Event[], systems: string[]) {
  const days = new Map<string, Record<Category, number>>();
  for (const e of events) {
    const k = dayKey(e.onset_unix);
    const row = days.get(k) ?? { pump_failure: 0, pipeline_leak: 0, pump_degradation: 0 };
    row[e.category]++;
    days.set(k, row);
  }
  const failures = events.filter((e) => e.category === "pump_failure").sort((a, b) => a.onset_unix - b.onset_unix);
  const gaps = failures.slice(1).map((e, i) => (e.onset_unix - failures[i].onset_unix) / 3600);
  const perFailure = failures
    .filter((e) => e.plan)
    .map((e) => {
      const nothing = [e.plan!.recommended, ...e.plan!.alternatives].find((o) => o.actions.length === 1 && o.actions[0].type === "none");
      return { id: e.id, facility: e.facility, label: e.plan!.recommended.label, cost: e.plan!.recommended.cost, nothing: nothing?.cost ?? e.plan!.recommended.cost };
    });
  const bySystem = systems.map((id) => {
    const mine = events.filter((e) => e.system === id);
    return {
      id,
      failures: mine.filter((e) => e.category === "pump_failure").length,
      leaks: mine.filter((e) => e.category === "pipeline_leak").length,
      wear: mine.filter((e) => e.category === "pump_degradation").length,
      trips: mine.reduce((s, e) => s + (e.plan?.recommended.actions.reduce((t, a) => (a.type === "dispatch_truck" ? t + a.trucks * a.trips_per_truck : t), 0) ?? 0), 0),
      cost: mine.reduce((s, e) => s + (e.plan?.recommended.cost ?? 0), 0),
    };
  });
  return {
    days: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, counts]) => ({ day, counts })),
    failures: failures.length,
    mtbfH: gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : null,
    recommended: perFailure.reduce((s, f) => s + f.cost, 0),
    avoided: perFailure.reduce((s, f) => s + Math.max(0, f.nothing - f.cost), 0),
    perFailure,
    bySystem,
  };
}
