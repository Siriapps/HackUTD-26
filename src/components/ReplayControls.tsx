"use client";

import { useEffect, useRef } from "react";
import { useOps } from "@/store";
import { TimeScrubber } from "./TimeScrubber";

const SPEEDS: { label: string; value: number }[] = [
  { label: "1 min/s", value: 60 },
  { label: "10 min/s", value: 600 },
  { label: "30 min/s", value: 1800 },
  { label: "1 h/s", value: 3600 },
];

/** Advances the console clock while playing. One ticker for the app, mounted in the top bar. */
export function useReplayTicker() {
  const playing = useOps((s) => s.playing);
  const speed = useOps((s) => s.speed);
  const tick = useOps((s) => s.tick);
  const last = useRef<number>(0);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    last.current = performance.now();
    const loop = (t: number) => {
      const dt = (t - last.current) / 1000;
      if (dt >= 0.25) {
        last.current = t;
        tick(dt * speed);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, tick]);
}

/** Play / pause, speed, scrub, and the auto-text kill switch. */
export function ReplayControls() {
  useReplayTicker();
  const playing = useOps((s) => s.playing);
  const speed = useOps((s) => s.speed);
  const autoText = useOps((s) => s.autoText);
  const setPlaying = useOps((s) => s.setPlaying);
  const setSpeed = useOps((s) => s.setSpeed);
  const setAutoText = useOps((s) => s.setAutoText);
  const dataset = useOps((s) => s.dataset);
  const nowOverride = useOps((s) => s.nowOverride);
  const setNow = useOps((s) => s.setNow);
  if (!dataset) return null;
  const atEnd = (nowOverride ?? dataset.now) >= dataset.now;

  return (
    <div className="flex items-center gap-2 min-w-0">
      <button
        type="button"
        className={`btn ${playing ? "btn-primary" : ""}`}
        onClick={() => {
          if (atEnd && !playing) setNow(dataset.ts[0] + 8 * 3600); // start a replay from early morning, not the end
          setPlaying(!playing);
        }}
        aria-pressed={playing}
        title={playing ? "Pause the replay" : "Replay the console clock"}
      >
        {playing ? "Pause" : "Play"}
      </button>
      <select className="select h-7 text-xs" value={speed} onChange={(e) => setSpeed(+e.target.value)} aria-label="Replay speed">
        {SPEEDS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <TimeScrubber />
      <label className="flex items-center gap-1.5 text-xs text-ink-2 whitespace-nowrap cursor-pointer" title="When an alert fires during replay, text the on-call tech automatically">
        <input type="checkbox" className="accent-[var(--accent)]" checked={autoText} onChange={(e) => setAutoText(e.target.checked)} />
        auto-text
      </label>
    </div>
  );
}
