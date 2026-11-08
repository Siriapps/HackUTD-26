"use client";

import { useRouter } from "next/navigation";
import { useOps } from "@/store";
import { Alerts } from "@/components/Alerts";
import { CATEGORY } from "@/components/Category";
import { FleetCard } from "@/components/FleetCard";
import { HandoffCard } from "@/components/HandoffCard";
import { MapPanel } from "@/components/MapPanel";

export default function DashboardPage() {
  const router = useRouter();
  const dataset = useOps((s) => s.dataset);
  const analysis = useOps((s) => s.analysis);
  if (!dataset || !analysis) return null;
  const failures = analysis.alerts.filter((e) => e.category === "pump_failure").length;

  return (
    <div className="ops-dash p-3">
      <section className="panel area-alerts flex flex-col min-h-0">
        <header className="panel-head">
          <h2 className="panel-title">Alerts</h2>
          <span className="panel-sub num">
            {analysis.alerts.length} in progress{failures ? ` · ${failures} tank${failures === 1 ? "" : "s"} filling` : ""}
          </span>
        </header>
        <div className="overflow-auto min-h-0 flex-1">
          <Alerts />
        </div>
      </section>

      <section className="panel area-map relative overflow-hidden min-h-[320px]">
        <MapPanel dataset={dataset} analysis={analysis} now={analysis.now} onOpen={(id) => router.push(`/facility/${id}`)} />
        <div className="absolute top-2 right-2 z-[500] panel px-2.5 py-2 text-xs text-ink-2 space-y-1 bg-surface-1/90">
          {(Object.keys(CATEGORY) as (keyof typeof CATEGORY)[]).map((k) => (
            <div key={k} className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: CATEGORY[k].mark }} /> {CATEGORY[k].label}
            </div>
          ))}
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--ok-mark)" }} /> Healthy facility
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full border border-ink-1" /> Disposal site
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 border border-ink-1 rotate-45 ml-px" /> Truck yard
          </div>
        </div>
      </section>

      <aside className="area-side flex flex-col gap-3 min-h-0">
        <FleetCard />
        <HandoffCard />
      </aside>
    </div>
  );
}
