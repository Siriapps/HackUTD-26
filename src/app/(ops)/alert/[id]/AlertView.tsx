"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useOps } from "@/store";
import { CATEGORY } from "@/components/Category";
import { CountdownRing } from "@/components/Countdown";
import { PlanCompare } from "@/components/PlanCompare";
import { PlanOfAction } from "@/components/PlanOfAction";
import { INFO, InfoTip } from "@/components/InfoTip";
import { Twin3DSlot } from "@/components/Twin3DSlot";
import { fmtClock, fmtHours, fmtMoney, fmtPct } from "@/components/format";
import { describeActions } from "@/lib/export/handoff";
import { dispatch } from "@/lib/export/notify";
import { facilityIndex, valueAt } from "@/store/select";

interface Thread {
  key: string;
  eventId: string;
  folder: string;
  handle: string;
  status: string;
  log: { at: number; dir: "out" | "in"; text: string }[];
}

/**
 * One alert, end to end: health now, the plan of action, the text that went out and the replies,
 * the technician's close-out. This is the page a fired alert opens.
 */
export function AlertView({ id }: { id: string }) {
  const router = useRouter();
  const dataset = useOps((s) => s.dataset);
  const analysis = useOps((s) => s.analysis);
  const [thread, setThread] = useState<Thread | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      const r = await fetch("/api/dispatch/state", { cache: "no-store" }).catch(() => null);
      if (!r?.ok) return;
      const all = (await r.json()) as Thread[];
      if (!stop) setThread(all.filter((a) => a.eventId === id).sort((a, b) => (b.log.at(-1)?.at ?? 0) - (a.log.at(-1)?.at ?? 0))[0] ?? null);
    };
    void load();
    const t = setInterval(load, 4000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [id]);

  if (!dataset || !analysis) return null;
  const event = analysis.events.find((e) => e.id === id);
  const q = `?folder=${encodeURIComponent(dataset.folder)}`;
  if (!event) {
    return (
      <div className="p-6 text-sm">
        <p className="text-ink-1">No alert <span className="num">{id}</span> at this time in {dataset.folder}.</p>
        <Link href={`/${q}`} className="btn mt-3">
          Back to the board
        </Link>
      </div>
    );
  }
  const cat = CATEGORY[event.category];
  const ref = facilityIndex(dataset).get(event.facility)!;
  const now = analysis.now;
  const level = valueAt(dataset, ref.facility.tank.id, "level_pct", now);
  const pumpStatus = valueAt(dataset, ref.facility.pump.id, "status", now);
  const horizon = dataset.ops.expected_repair_hours.pump_failure;
  const htl = event.hours_to_limit?.p50;

  async function text() {
    if (!armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 4000);
      return;
    }
    setArmed(false);
    setNote("Sending…");
    const r = await fetch("/api/dispatch/alert", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventId: id, folder: dataset!.folder, asOf: now }) });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; reason?: string; to?: string; message?: string };
    setNote(j.ok === false || !r.ok ? `Not sent: ${j.error ?? j.reason ?? r.status}` : `Texted ${j.to ?? "on-call"} ${j.reason ? `(${j.reason})` : ""}`);
  }
  async function falseAlarm() {
    setNote("Logging…");
    const r = await dispatch({ type: "alert", folder: dataset!.folder, now, text: `False alarm logged for ${event!.id} by ops`, event: { ...event!, evidence: ["ops: false alarm"] }, links: { dashboard: `/${q}` } });
    setNote(r.message);
  }

  return (
    <div className="alert p-3">
      <header className="alert__head">
        <div className="min-w-0">
          <Link href={`/${q}`} className="text-sm text-ink-3 hover:text-ink-1">
            ← Board
          </Link>
          <div className="mt-1 flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl num">{event.facility}</h1>
            <span className="chip" style={{ background: cat.wash, color: cat.ink }}>
              {cat.label}
            </span>
            <span className="num text-sm text-ink-3">{event.id}</span>
            <span className="num text-sm text-ink-3">since {fmtClock(event.onset_unix)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className={`btn ${armed ? "btn-primary" : ""}`} onClick={text}>
            {armed ? "Tap again to text" : thread ? "Text again" : "Text on-call"}
          </button>
          <Link href={`/field/${event.id}${q}`} className="btn">
            Field view
          </Link>
          <Link href={`/facility/${event.facility}${q}`} className="btn">
            Facility
          </Link>
          <button type="button" className="btn" onClick={falseAlarm}>
            False alarm
          </button>
          {note && <span className="text-xs text-ink-3">{note}</span>}
        </div>
      </header>

      <section className="panel alert__health">
        <header className="panel-head">
          <h2 className="panel-title">Health now</h2>
          <span className="panel-sub num">{fmtClock(now)}</span>
        </header>
        <div className="px-4 py-3 grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 items-center">
          {htl != null ? (
            <CountdownRing hours={htl} horizonHours={horizon} size={72} caption="tank">
              {fmtPct(level, 0)}
            </CountdownRing>
          ) : (
            <span className="inline-grid place-items-center w-[72px] h-[72px] rounded-full" style={{ background: cat.wash, color: cat.ink }}>
              <span className="num text-sm">{fmtPct(level, 0)}</span>
            </span>
          )}
          <div>
            {htl != null ? (
              <p className="num-display text-3xl leading-none" style={{ color: htl < 1 ? "var(--shutdown)" : "var(--text-1)" }}>
                {fmtHours(htl)} <span className="text-base text-ink-2 font-sans">to shutdown · {fmtClock(now + htl * 3600)}</span>
              </p>
            ) : (
              <p className="text-lg text-ink-1">No countdown: the tank keeps draining.</p>
            )}
            <p className="mt-1 text-sm text-ink-2">
              Pump <span className="num text-ink-1">{pumpStatus === 2 ? "fault" : pumpStatus === 1 ? "running" : "off"}</span> · tank <span className="num text-ink-1">{fmtPct(level)}</span>
              {event.lost_revenue_per_hr ? (
                <>
                  {" "}
                  · shut-in loses <span className="num text-ink-1">{fmtMoney(event.lost_revenue_per_hr)}/h</span>
                </>
              ) : null}
              {" · "}conf <span className="num">{Math.round(event.confidence * 100)}%</span>
            </p>
          </div>
          <ul className="col-span-2 text-sm text-ink-2 space-y-1">
            {event.evidence.map((l, i) => (
              <li key={i} className="pl-3 relative before:absolute before:left-0 before:top-[9px] before:w-1.5 before:h-px before:bg-ink-2">
                {l}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="panel alert__plan">
        <header className="panel-head">
          <h2 className="panel-title flex items-center gap-1.5">
            Plan of action <InfoTip title={INFO.plan.title} align="left">{INFO.plan.body}</InfoTip>
          </h2>
          {event.plan && (
            <span className="panel-sub">
              <span className="num text-ink-1 font-semibold" style={{ color: event.plan.recommended.feasible ? "var(--ok)" : "var(--shutdown)" }}>
                {fmtMoney(event.plan.recommended.cost)}
              </span>{" "}
              · {describeActions(event.plan.recommended.actions)}
            </span>
          )}
        </header>
        <div className="px-4 py-3">
          <PlanOfAction event={event} dataset={dataset} now={now} />
        </div>
      </section>

      <section className="panel alert__twin">
        <header className="panel-head">
          <h2 className="panel-title">Digital twin</h2>
          <span className="panel-sub">live</span>
        </header>
        <div className="relative min-h-[300px] flex-1">
          <Twin3DSlot facilityId={event.facility} bare />
        </div>
      </section>

      <section className="panel alert__thread">
        <header className="panel-head">
          <h2 className="panel-title">Technician thread</h2>
          <span className="panel-sub num">{thread ? `${thread.handle} · ${thread.status}` : "not texted yet"}</span>
        </header>
        <div className="px-4 py-3 text-sm">
          {!thread ? (
            <p className="text-ink-3">Press “Text on-call”. The message carries the countdown, the plan and a link to the field view. Replies land here.</p>
          ) : (
            <ol className="space-y-2">
              {thread.log.map((l, i) => (
                <li key={i} className={`sms ${l.dir === "in" ? "sms--in" : "sms--out"}`}>
                  <span className="num text-xs text-ink-3">{new Date(l.at).toISOString().slice(11, 16)}Z</span>
                  <p className="whitespace-pre-wrap">{l.text}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      {event.plan && (
        <section className="panel alert__options">
          <header className="panel-head">
            <h2 className="panel-title flex items-center gap-1.5">
              Every option, priced <InfoTip title={INFO.plan.title} align="left">{INFO.plan.body}</InfoTip>
            </h2>
            <span className="panel-sub">minute-by-minute tank simulation</span>
          </header>
          <div className="px-4 py-3">
            <PlanCompare event={event} dataset={dataset} />
          </div>
        </section>
      )}
      <button type="button" className="sr-only" onClick={() => router.back()}>
        back
      </button>
    </div>
  );
}
