"use client";

import dynamic from "next/dynamic";
import type { NetworkMapProps } from "./Map";

// Leaflet touches `window` at import time, so the map only ever renders on the client.
const NetworkMap = dynamic(() => import("./Map").then((m) => m.NetworkMap), {
  ssr: false,
  loading: () => <div className="h-full grid place-items-center text-sm text-ink-3">Loading map…</div>,
});

export function MapPanel(props: NetworkMapProps) {
  return <NetworkMap {...props} />;
}
