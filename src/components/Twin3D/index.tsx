"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";
import { TankSvg } from "../TankSvg";
import { eventActiveAt, planLevelAt } from "./derive";
import { CATEGORY_CHIP, CATEGORY_LABEL, type Twin3DProps } from "./types";

export type { Twin3DProps, TwinLimits, TwinReadings, TwinTrucking } from "./types";
export { CATEGORY_CHIP, CATEGORY_LABEL } from "./types";
export { eventActiveAt, findFacility, indexAt, planLevelAt, readingsAt, truckSchedule } from "./derive";

// Three.js stays out of the main bundle and off the server.
const Scene = dynamic(() => import("./Scene"), { ssr: false, loading: () => <Skeleton /> });

let webglProbe: boolean | null = null;
function hasWebGL(): boolean {
  if (webglProbe !== null) return webglProbe;
  try {
    const c = document.createElement("canvas");
    webglProbe = !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    webglProbe = false;
  }
  return webglProbe;
}
const noSubscribe = () => () => {};
/** null on the server / first paint, then the probe result. */
const useWebGL = () => useSyncExternalStore(noSubscribe, hasWebGL, () => null);

function Skeleton() {
  return <div className="absolute inset-0 animate-pulse bg-surface-1" aria-hidden />;
}

const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/**
 * Digital twin of one facility: tank fill with warning/shutdown rings, pump glowing by status, pipeline flow
 * particles scaled to receive flow, leak drips, truck arrivals for a plan. Falls back to `TankSvg` without WebGL.
 * Size it with `height` or let it take a 16:9 box.
 */
export function Twin3D(props: Twin3DProps & { height?: number | string }) {
  const webgl = useWebGL();
  const { height, className, hud = true } = props;
  return (
    <div
      className={`relative overflow-hidden rounded-lg border border-line-1 bg-surface-0 ${className ?? ""}`}
      style={{ height, aspectRatio: height ? undefined : "16 / 9" }}
      data-twin={webgl === null ? "init" : webgl ? "3d" : "svg"}
    >
      {webgl === null ? <Skeleton /> : webgl ? <Scene {...props} /> : <TankSvg {...props} />}
      {hud && <Hud {...props} />}
    </div>
  );
}

function Hud({ facility, readings, limits, event, plan, t }: Twin3DProps) {
  const active = event && eventActiveAt(event, t) ? event : undefined;
  const planned = plan ? planLevelAt(plan, t) : null;
  const level = planned ?? readings.level_pct;
  const pump =
    readings.pump_status === 2
      ? { word: "fault", cls: "text-cat-failure" }
      : readings.pump_status === 1
        ? { word: "running", cls: "text-ok" }
        : { word: "off", cls: "text-ink-2" };
  const levelCls = level >= limits.shutdown ? "text-shutdown" : level >= limits.warning ? "text-warn" : "text-ink-1";
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-x-4 gap-y-1 px-3 py-2 bg-gradient-to-t from-[rgb(5_8_15/0.85)] to-transparent">
      <div className="flex items-center gap-2">
        <span className="num text-sm text-ink-1">{facility.id}</span>
        {active && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_CHIP[active.category]}`}>
            {CATEGORY_LABEL[active.category]}
          </span>
        )}
      </div>
      <dl className="num flex flex-wrap items-baseline justify-end gap-x-3 gap-y-0.5 text-xs text-ink-2 min-w-0">
        <div>
          <dt className="sr-only">Tank level</dt>
          <dd>
            <span className={levelCls}>{level.toFixed(1)}</span>
            <span className="text-ink-3"> % tank{planned != null ? " (plan)" : ""}</span>
          </dd>
        </div>
        <div>
          <dt className="sr-only">Pump</dt>
          <dd>
            <span className={pump.cls}>{pump.word}</span>
            <span className="text-ink-3"> {fmt.format(readings.flow_bpd)} bpd</span>
          </dd>
        </div>
        <div>
          <dt className="sr-only">Pipeline receive flow</dt>
          <dd>
            <span>{fmt.format(readings.receive_flow_bpd)}</span>
            <span className="text-ink-3"> bpd received</span>
          </dd>
        </div>
        <div>
          <dt className="sr-only">Inflow</dt>
          <dd>
            <span>{fmt.format(readings.inflow_bpd)}</span>
            <span className="text-ink-3"> bpd in</span>
          </dd>
        </div>
      </dl>
    </div>
  );
}
