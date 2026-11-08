"use client";

import { useState } from "react";
import { useOps } from "@/store";
import { CATEGORY } from "./Category";
import { fmtDay, fmtTime } from "./format";

/**
 * Scrubs the console's "now" across the telemetry. The label follows the thumb live; the analysis
 * recomputes when the thumb is released (analyse() is not free on full_week).
 */
export function TimeScrubber({ full = false }: { full?: boolean }) {
  const dataset = useOps((s) => s.dataset);
  const nowOverride = useOps((s) => s.nowOverride);
  const fullAnalysis = useOps((s) => s.fullAnalysis);
  const setNow = useOps((s) => s.setNow);
  const committed = nowOverride ?? dataset?.now ?? 0;
  const [pending, setPending] = useState(committed);
  const [seen, setSeen] = useState(committed);
  if (seen !== committed) {
    // The committed clock moved (folder switch, "back to live", a jump from the timeline): follow it.
    setSeen(committed);
    setPending(committed);
  }
  if (!dataset) return null;
  const min = dataset.ts[0];
  const max = dataset.now;
  const span = max - min;
  const onsets = full ? (fullAnalysis?.events ?? []) : [];

  return (
    <div className={full ? "px-4 py-3" : "flex items-center gap-2"}>
      {full && (
        <div className="flex items-baseline justify-between mb-1">
          <div>
            <span className="text-ink-3 text-sm">Console clock </span>
            <span className="num text-lg font-semibold">{fmtTime(pending)}</span>
            {nowOverride != null && <span className="ml-2 text-xs text-ink-3">{fmtDay(pending)} · time travel</span>}
          </div>
          <div className="num text-xs text-ink-3">
            {fmtTime(min)} → {fmtTime(max)}
          </div>
        </div>
      )}
      <div className={`relative ${full ? "" : "w-[200px]"}`}>
        {full && onsets.length > 0 && (
          <div className="absolute inset-x-[6px] top-[9px] h-0.5 pointer-events-none" aria-hidden>
            {onsets.map((e) => (
              <span
                key={e.id}
                className="absolute -top-[3px] w-px h-2 rounded"
                style={{ left: `${((e.onset_unix - min) / span) * 100}%`, background: CATEGORY[e.category].mark }}
              />
            ))}
          </div>
        )}
        <input
          type="range"
          className="scrub relative"
          min={min}
          max={max}
          step={300}
          value={pending}
          aria-label="Console clock"
          onChange={(e) => setPending(+e.target.value)}
          onPointerUp={() => setNow(pending)}
          onKeyUp={(e) => {
            if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(e.key)) setNow(pending);
          }}
        />
      </div>
      {!full && (
        <span className="num text-xs text-ink-2 whitespace-nowrap w-[92px]" aria-live="polite">
          {fmtTime(pending)}
        </span>
      )}
      {nowOverride != null ? (
        <button type="button" className={`btn ${full ? "mt-2" : "h-6 text-xs"}`} onClick={() => setNow(null)}>
          Back to live
        </button>
      ) : (
        <span className={`flex items-center gap-1.5 text-xs text-ink-2 ${full ? "mt-2" : ""}`}>
          <span className="live-dot" /> live
        </span>
      )}
    </div>
  );
}
