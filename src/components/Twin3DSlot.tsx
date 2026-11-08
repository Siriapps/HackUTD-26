"use client";

import { Twin3D, readingsAt } from "@/components/Twin3D";
import { useOps } from "@/store";
import { facilityIndex, ongoingAt } from "@/store/select";

/**
 * Facility-page mount for the digital twin. Lazy Three.js scene lives inside `Twin3D`
 * (`next/dynamic`, `ssr: false`); falls back to `TankSvg` without WebGL.
 */
export function Twin3DSlot({ facilityId }: { facilityId: string }) {
  const dataset = useOps((s) => s.dataset);
  const analysis = useOps((s) => s.analysis);

  if (!dataset || !analysis) {
    return (
      <div
        className="h-full min-h-[220px] rounded-lg border border-dashed border-line-2 grid place-items-center text-center px-4 bg-surface-0"
        data-twin-slot={facilityId}
      >
        <p className="text-sm text-ink-3">Load a folder to open the digital twin.</p>
      </div>
    );
  }

  const ref = facilityIndex(dataset).get(facilityId);
  if (!ref) {
    return (
      <div
        className="h-full min-h-[220px] rounded-lg border border-dashed border-line-2 grid place-items-center text-center px-4 bg-surface-0"
        data-twin-slot={facilityId}
      >
        <p className="text-sm text-ink-3">
          No facility <span className="num">{facilityId}</span> in this folder.
        </p>
      </div>
    );
  }

  const { facility, system } = ref;
  const now = analysis.now;
  const events = ongoingAt(analysis, facility.id);
  const event = events.find((e) => e.category === "pump_failure") ?? events[0];
  const plan = event?.plan;
  const opsF = dataset.ops.systems[system.id]?.facilities[facility.id];
  const trucking = opsF ? { response_min: opsF.response_min, cycle_min: opsF.cycle_min } : undefined;

  return (
    <section className="panel h-full min-h-[220px] flex flex-col overflow-hidden" data-twin-slot={facilityId}>
      <header className="panel-head shrink-0">
        <h2 className="panel-title">Digital twin</h2>
        <span className="panel-sub">Pipe system · tank · pump</span>
      </header>
      <div className="relative flex-1 min-h-[200px]">
        <Twin3D
          facility={facility}
          readings={readingsAt(dataset, facility, now)}
          limits={dataset.network.defaults.tank_limits_pct}
          t={now}
          event={event}
          plan={plan}
          trucking={trucking}
          className="absolute inset-0 rounded-none border-0"
          height="100%"
        />
      </div>
    </section>
  );
}
