"use client";

import { useOps } from "@/store";
import { INFO, InfoTip } from "./InfoTip";

/** Trucks per system: committed by the joint plan at "now" vs free. */
export function FleetCard() {
  const analysis = useOps((s) => s.analysis);
  const dataset = useOps((s) => s.dataset);
  if (!analysis || !dataset) return null;
  const systems = dataset.network.systems.map((s) => s.id);
  const busy = new Map<string, number>();
  for (const e of analysis.alerts) if (e.category === "pump_failure") busy.set(e.system, (busy.get(e.system) ?? 0) + 1);

  return (
    <section className="panel">
      <header className="panel-head">
        <h2 className="panel-title flex items-center gap-1.5">
          Truck fleets <InfoTip title={INFO.fleet.title}>{INFO.fleet.body}</InfoTip>
        </h2>
        <span className="panel-sub">{dataset.ops.emergency_trucking.truck_capacity_bbl} bbl a trip</span>
      </header>
      <ul className="px-4 py-2">
        {systems.map((id) => {
          const f = analysis.fleet[id] ?? { size: dataset.ops.systems[id]?.emergency_fleet_size ?? 0, committed: 0 };
          const free = Math.max(0, f.size - f.committed);
          const failures = busy.get(id) ?? 0;
          return (
            <li key={id} className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 py-1.5">
              <span className="num font-semibold text-ink-1">{id}</span>
              <span className="flex gap-0.5" aria-label={`${f.committed} of ${f.size} trucks committed`}>
                {Array.from({ length: f.size }, (_, i) => (
                  <span
                    key={i}
                    className="h-2 flex-1 max-w-10 rounded-[2px]"
                    style={{ background: i < f.committed ? "var(--cat-failure-mark)" : "var(--line-2)" }}
                  />
                ))}
              </span>
              <span className="num text-xs text-ink-2 text-right">
                {f.committed ? (
                  <>
                    <span className="text-ink-1">{f.committed}</span> committed · {free} free
                    {failures > f.committed ? ` · ${failures} failures` : ""}
                  </>
                ) : (
                  <>{f.size} free</>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
