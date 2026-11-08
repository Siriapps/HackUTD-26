"use client";

import Link from "next/link";
import { useOps } from "@/store";
import { CATEGORY } from "@/components/Category";
import { RetrainCard } from "@/components/RetrainCard";
import { fmtClock, fmtDay, fmtMoney } from "@/components/format";

/** The week as a calendar: every event, when it started and ended, what it cost; the learning loop under it. */
export default function LogPage() {
  const dataset = useOps((s) => s.dataset);
  const analysis = useOps((s) => s.analysis);
  const full = useOps((s) => s.fullAnalysis);
  if (!dataset || !analysis) return null;
  const events = (full ?? analysis).events;
  const q = `?folder=${encodeURIComponent(dataset.folder)}`;
  const dayKey = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
  const days: string[] = [];
  for (let t = dataset.ts[0]; t <= dataset.now; t += 86400) {
    const k = dayKey(t);
    if (!days.includes(k)) days.push(k);
  }
  const last = dayKey(dataset.now);
  if (!days.includes(last)) days.push(last);
  const byDay = new Map<string, typeof events>();
  for (const e of events) {
    const k = dayKey(e.onset_unix);
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }
  const costs = events.filter((e) => e.plan).reduce((s, e) => s + e.plan!.recommended.cost, 0);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1500px]">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl">Log</h1>
          <p className="text-sm text-ink-2 mt-1">
            {events.length} events this week in {dataset.folder} · recommended plans total <span className="num text-ink-1">{fmtMoney(costs)}</span> · tonight&apos;s close-outs become tomorrow&apos;s training data.
          </p>
        </div>
      </header>

      <ol className="grid grid-cols-7 max-[1100px]:grid-cols-4 max-[760px]:grid-cols-2 gap-3" aria-label="Week">
        {days.map((d) => {
          const list = (byDay.get(d) ?? []).sort((a, b) => a.onset_unix - b.onset_unix);
          const isToday = d === last;
          return (
            <li key={d} className={`panel min-h-[180px] ${isToday ? "ring-2 ring-[var(--focus)]" : ""}`}>
              <header className="panel-head">
                <h2 className="panel-title num">{fmtDay(Date.parse(d) / 1000)}</h2>
                <span className="panel-sub num">{list.length || ""}</span>
              </header>
              <ul className="p-2 space-y-1.5">
                {list.map((e) => (
                  <li key={e.id}>
                    <Link href={`/alert/${e.id}${q}`} className="block rounded px-2 py-1.5 text-xs hover:bg-surface-2" style={{ borderLeft: `2px solid ${CATEGORY[e.category].mark}` }}>
                      <span className="num text-ink-1">{fmtClock(e.onset_unix)}</span> <span className="text-ink-2">{CATEGORY[e.category].label}</span>
                      <span className="block num text-ink-3 truncate">{e.facility}</span>
                      <span className="block text-ink-3">
                        {e.status === "ongoing" ? "in progress" : `→ ${e.end_unix ? fmtClock(e.end_unix) : "?"}`}
                        {e.plan ? ` · ${fmtMoney(e.plan.recommended.cost)}` : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>

      <RetrainCard />
    </div>
  );
}
