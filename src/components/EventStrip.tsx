"use client";

import type { Analysis, Dataset } from "@/lib/data/types";
import { CATEGORY } from "./Category";
import { fmtDay, fmtTime } from "./format";

/** Every event in the folder as a bar per facility, with the console clock drawn over it. Click to jump. */
export function EventStrip({
  dataset,
  full,
  now,
  onPick,
}: {
  dataset: Dataset;
  full: Analysis;
  now: number;
  onPick: (t: number) => void;
}) {
  const min = dataset.ts[0];
  const max = dataset.now;
  const span = Math.max(1, max - min);
  const pct = (t: number) => `${((Math.min(max, Math.max(min, t)) - min) / span) * 100}%`;
  const facilities = Array.from(new Set(full.events.map((e) => e.facility)));
  const days: number[] = [];
  for (let t = Math.ceil(min / 86400) * 86400; t <= max; t += 86400) days.push(t);

  if (!full.events.length) {
    return <p className="px-4 py-6 text-sm text-ink-3">No events detected anywhere in {dataset.folder}.</p>;
  }

  return (
    <div className="px-4 pb-3">
      <div className="relative grid grid-cols-[150px_minmax(0,1fr)] gap-x-3">
        <div />
        <div className="relative h-5 num text-[10px] text-ink-3">
          {days.map((d) => (
            <span key={d} className="absolute top-1 -translate-x-1/2" style={{ left: pct(d) }}>
              {fmtDay(d)}
            </span>
          ))}
        </div>
        {facilities.map((fid) => (
          <div key={fid} className="contents">
            <div className="num text-xs text-ink-2 h-6 flex items-center truncate">{fid}</div>
            <div
              className="relative h-6 border-t border-line-1 cursor-crosshair"
              onClick={(ev) => {
                const r = ev.currentTarget.getBoundingClientRect();
                onPick(min + ((ev.clientX - r.left) / r.width) * span);
              }}
            >
              {days.map((d) => (
                <span key={d} className="absolute top-0 bottom-0 w-px bg-line" style={{ left: pct(d) }} />
              ))}
              {full.events
                .filter((e) => e.facility === fid)
                .map((e) => {
                  const end = e.end_unix ?? max;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      className="absolute top-[7px] h-2.5 rounded-[2px] min-w-[3px] focus-visible:outline-none"
                      style={{ left: pct(e.onset_unix), width: `calc(${pct(end)} - ${pct(e.onset_unix)})`, background: CATEGORY[e.category].mark, opacity: e.onset_unix > now ? 0.35 : 1 }}
                      title={`${e.id} ${CATEGORY[e.category].label} ${fmtTime(e.onset_unix)} → ${e.end_unix ? fmtTime(e.end_unix) : "ongoing"}`}
                      aria-label={`${e.id} ${CATEGORY[e.category].label} at ${fid}, from ${fmtTime(e.onset_unix)}`}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onPick(e.onset_unix + 1800);
                      }}
                    />
                  );
                })}
            </div>
          </div>
        ))}
        <div />
        <div className="relative h-0">
          <span
            className="absolute bottom-0 w-px pointer-events-none"
            style={{ left: pct(now), height: `${facilities.length * 24 + 6}px`, background: "var(--accent)" }}
            aria-hidden
          />
        </div>
      </div>
      <div className="mt-2 flex items-center gap-4 text-xs text-ink-3">
        {(Object.keys(CATEGORY) as (keyof typeof CATEGORY)[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="w-3 h-1.5 rounded-[1px]" style={{ background: CATEGORY[k].mark }} /> {CATEGORY[k].label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="w-px h-3" style={{ background: "var(--accent)" }} /> console clock
        </span>
      </div>
    </div>
  );
}
