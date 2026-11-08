"use client";

import Link from "next/link";
import { useState } from "react";
import type { Event } from "@/lib/data/types";
import { useOps } from "@/store";
import { CATEGORY, CategoryChip } from "./Category";
import { CountdownRing } from "./Countdown";
import { fmtClock, fmtHours, fmtMoney, fmtPct, fmtTime } from "./format";
import { describeActions, planLine } from "@/lib/export/handoff";
import { dispatch } from "@/lib/export/notify";

/** Alerts in SPEC order: pump failures by hours_to_limit, then leaks and worn pumps. */
export function Alerts({ compact = false }: { compact?: boolean }) {
  const analysis = useOps((s) => s.analysis);
  const dataset = useOps((s) => s.dataset);
  const nowOverride = useOps((s) => s.nowOverride);
  if (!analysis || !dataset) return null;
  const { alerts, now } = analysis;
  const horizon = dataset.ops.expected_repair_hours.pump_failure;

  if (!alerts.length) {
    return (
      <div className="px-4 py-8 text-sm text-ink-2">
        <p className="text-ink-1 font-medium">Nothing in progress at {fmtTime(now)}.</p>
        <p className="mt-1">Every pump is moving water and every flow ratio sits at baseline.</p>
        {nowOverride == null && (
          <p className="mt-3 text-ink-3">Scrub the clock back in the top bar, or open the timeline, to replay earlier problems.</p>
        )}
      </div>
    );
  }

  // SPEC order puts every pump failure first, so the index is its priority rank.
  return (
    <ol className="divide-y divide-line">
      {alerts.map((e, i) => (
        <AlertRow key={e.id} e={e} rank={e.category === "pump_failure" ? i + 1 : null} now={now} horizon={horizon} compact={compact} folder={dataset.folder} />
      ))}
    </ol>
  );
}

function AlertRow({
  e,
  rank,
  now,
  horizon,
  compact,
  folder,
}: {
  e: Event;
  rank: number | null;
  now: number;
  horizon: number;
  compact: boolean;
  folder: string;
}) {
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const htl = e.hours_to_limit?.p50;
  const cat = CATEGORY[e.category];
  const elapsedH = (now - e.onset_unix) / 3600;

  async function send() {
    setBusy(true);
    const res = await dispatch({
      type: "alert",
      folder,
      now,
      text: alertText(e, now),
      event: e,
      links: { facility: `/facility/${e.facility}`, field: `/field/${e.id}`, dashboard: "/" },
    });
    setSent(res.message);
    setBusy(false);
  }

  return (
    <li className="relative">
      <div className={`grid grid-cols-[44px_minmax(0,1fr)] gap-x-3 ${compact ? "px-3 py-2.5" : "px-4 py-3"}`}>
        <div className="pt-0.5">
          {htl != null ? (
            <CountdownRing hours={htl} horizonHours={horizon} size={44}>
              {e.level_pct != null ? `${Math.round(e.level_pct)}%` : ""}
            </CountdownRing>
          ) : (
            <span
              className="inline-grid place-items-center w-[44px] h-[44px] rounded-full"
              style={{ background: cat.wash, color: cat.ink }}
            >
              <span className="num text-[10px] text-ink-2">{fmtHours(elapsedH)}</span>
            </span>
          )}
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            {rank != null && <span className="num text-sm text-ink-3 w-3">{rank}</span>}
            <Link href={`/facility/${e.facility}`} className="num font-semibold text-ink-1 truncate hover:underline">
              {e.facility}
            </Link>
            <CategoryChip category={e.category} compact={compact} />
            <span className="ml-auto num text-xs text-ink-3" title="Detector confidence">
              {Math.round(e.confidence * 100)}%
            </span>
          </div>

          {htl != null ? (
            <div className="mt-1 flex items-baseline gap-2 flex-wrap">
              <span className="num-display text-xl leading-none" style={{ color: htl < 1 ? "var(--shutdown)" : "var(--text-1)" }}>
                {fmtHours(htl)}
              </span>
              <span className="text-sm text-ink-2">
                to shutdown{" "}
                <span className="num text-ink-3">
                  ({fmtClock(now + htl * 3600)}
                  {e.hours_to_limit && e.hours_to_limit.p10 !== e.hours_to_limit.p90
                    ? `, ${fmtHours(e.hours_to_limit.p10)}–${fmtHours(e.hours_to_limit.p90)}`
                    : ""}
                  )
                </span>
              </span>
            </div>
          ) : (
            <div className="mt-1 text-sm text-ink-2">
              Since <span className="num">{fmtTime(e.onset_unix)}</span> · no countdown, the tank keeps draining
            </div>
          )}

          <div className="mt-1 text-sm">
            {e.plan ? (
              <>
                <span className="text-ink-3">Plan</span>{" "}
                <span className="num text-ink-1">{describeActions(e.plan.recommended.actions)}</span>{" "}
                <span className="num font-semibold text-ink-1">{fmtMoney(e.plan.recommended.cost)}</span>
                {!compact && e.plan.alternatives[0] && (
                  <span className="text-ink-3">
                    {" "}
                    · next best {fmtMoney(e.plan.alternatives[0].cost)}
                  </span>
                )}
              </>
            ) : (
              <>
                <span className="text-ink-3">Action</span> <span className="text-ink-1">{describeActions(e.actions)}</span>
              </>
            )}
          </div>

          {!compact && (
            <ul className="mt-1.5 space-y-0.5 text-sm text-ink-2">
              {e.evidence.slice(0, 3).map((line, i) => (
                <li key={i} className="pl-3 relative before:absolute before:left-0 before:top-[9px] before:w-1.5 before:h-px before:bg-ink-2">
                  {line}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-2 flex items-center gap-1 text-xs">
            <Link href={`/facility/${e.facility}`} className="btn btn-quiet h-6 text-xs">
              {e.plan ? "Open plan" : "Open facility"}
            </Link>
            <Link href={`/field/${e.id}`} className="btn btn-quiet h-6 text-xs">
              Field view
            </Link>
            <button type="button" className="btn btn-quiet h-6 text-xs" onClick={send} disabled={busy}>
              {busy ? "Sending…" : "Dispatch"}
            </button>
            {sent && <span className="ml-1 text-ink-3 truncate">{sent}</span>}
          </div>
        </div>
      </div>
    </li>
  );
}

export function alertText(e: Event, now: number): string {
  const cat = CATEGORY[e.category].label;
  const htl = e.hours_to_limit?.p50;
  const cd = htl != null ? `tank ${fmtPct(e.level_pct ?? NaN)}, shutdown in ${fmtHours(htl)} (${fmtClock(now + htl * 3600)})` : `since ${fmtClock(e.onset_unix)}`;
  return `${cat} at ${e.facility} (${e.asset}): ${cd}. Plan: ${planLine(e)}. ${e.evidence.join(" ")}`;
}
