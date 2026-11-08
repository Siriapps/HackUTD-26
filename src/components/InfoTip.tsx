"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The ⓘ on every visual: what it shows, where the numbers come from, how to read it.
 * Keyboard and pointer friendly; one open at a time per page is enough for a console.
 */
export function InfoTip({ title, children, align = "right" }: { title: string; children: React.ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <span ref={ref} className="infotip">
      <button type="button" className="infotip__btn" aria-expanded={open} aria-label={`About: ${title}`} onClick={() => setOpen((o) => !o)}>
        i
      </button>
      {open && (
        <div className={`infotip__pop infotip__pop--${align}`} role="dialog" aria-label={title}>
          <p className="infotip__title">{title}</p>
          <div className="infotip__body">{children}</div>
        </div>
      )}
    </span>
  );
}

/** Copy for the console's visuals, in one place so wording stays consistent. */
export const INFO = {
  race: {
    title: "Shutdown race",
    body: "Every tank with a failed pump, ordered by how soon it reaches the shutdown limit if nobody acts. The red tick is that moment. The bar is what happens under the recommended plan: green runs to the repair end when the tank holds, red stops where it trips. Amber is the stretch where the tank is still filling before the first truck or shut-in bites. Times come from the tank's own fill rate and the repair duration in ops.json.",
  },
  queue: {
    title: "Queue",
    body: "Everything in progress, in the order the spec requires: pump failures by time to shutdown, then leaks and worn pumps. The ring is tank level over the repair horizon. The cost is the cheapest plan that keeps the tank under the limit. 'conf' is the detector's confidence; worn pumps also show when the forecast says they fail.",
  },
  stage: {
    title: "Digital twin and plan",
    body: "A live model of the selected facility built from network.json and telemetry: tank level, pump state, pipeline flow. Under it, the plan of action as a timed checklist and the minute-by-minute simulation of every option the optimiser priced. The recommended line is the cheapest that never crosses the shutdown line.",
  },
  fleet: {
    title: "Truck fleets",
    body: "Each system's emergency trucks (ops.json). When several pumps fail in one system, the plans are solved together over the shared fleet, which is why one facility may get a shut-in while its neighbours get trucks.",
  },
  dispatch: {
    title: "Dispatch log",
    body: "Texts sent to the on-call technician over iMessage and their replies, live. YES approves the plan, OMW acknowledges, FIXED closes and asks for a note. Silence escalates on a timer set from the countdown.",
  },
  handoff: {
    title: "Shift handoff",
    body: "A 30-second brief for the morning crew generated from the same analysis: every failure with its plan and cost, inspections due, trucks committed. Copy it or text it.",
  },
  plan: {
    title: "Every option, priced",
    body: "The optimiser simulates the tank minute by minute under each option: do nothing, each truck count and trip count, each set of wells shut in at the latest safe moment, and mixes. Trucks arrive response_min after the call and every cycle_min after that, each removing truck_capacity_bbl. Shut-in cost is the lost oil and gas revenue for the hours the well is off. These numbers match the reference answers.",
  },
  forecast: {
    title: "Failure forecast",
    body: "For a worn pump, a line fitted to the pump's flow ratio since the wear began, projected to the ratio seen just before this dataset's own wear failures, and to the point where the pump can no longer keep up with inflow. Confidence comes from the fit.",
  },
  signal: {
    title: "Signal",
    body: "The raw ratios the detector watches, against each facility's own healthy band: receive flow over pump flow (leak), pump flow over rated (wear), discharge and pipeline pressure over the disposal site's. Bands are median and spread learned from this folder, so a new network needs no tuning.",
  },
} as const;
