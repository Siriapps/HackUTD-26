"use client";

import { useState } from "react";
import type { Dataset, Event } from "@/lib/data/types";
import { planSteps, type PlanStep } from "@/lib/export/planSteps";
import { fmtClock } from "./format";
import { TruckGlyph } from "./TruckGlyph";

const WHO: Record<PlanStep["who"], string> = { operator: "Ops", trucks: "Trucks", technician: "Tech", system: "" };

/** The plan as a timed checklist. Checks are local to this screen (what the operator has done). */
export function PlanOfAction({ event, dataset, now, compact = false }: { event: Event; dataset: Dataset; now: number; compact?: boolean }) {
  const steps = planSteps(event, dataset, now);
  const [done, setDone] = useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setDone((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  return (
    <ol className={`poa ${compact ? "poa--compact" : ""}`} aria-label="Plan of action">
      {steps.map((s, i) => {
        const past = s.at < now;
        return (
          <li key={i} className={`poa__step poa__step--${s.kind} ${done.has(i) ? "is-done" : ""} ${past ? "is-past" : ""}`}>
            <span className="poa__time num">{fmtClock(s.at)}</span>
            <span className="poa__mark" aria-hidden>
              {s.kind === "arrive" ? <TruckGlyph size={16} /> : s.kind === "do" ? <i /> : s.kind === "end" ? <b /> : <u />}
            </span>
            <label className="poa__body">
              {s.kind === "do" ? <input type="checkbox" checked={done.has(i)} onChange={() => toggle(i)} aria-label={`Done: ${s.text}`} /> : <span className="w-4" />}
              <span>
                {WHO[s.who] && <span className="poa__who">{WHO[s.who]}</span>}
                <span className="poa__text">{s.text}</span>
                {s.detail && <span className="poa__detail num">{s.detail}</span>}
              </span>
            </label>
          </li>
        );
      })}
    </ol>
  );
}
