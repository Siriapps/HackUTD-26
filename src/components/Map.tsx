"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { Fragment, useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Marker, Polygon, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { Analysis, Dataset } from "@/lib/data/types";
import { CATEGORY, worstEvent } from "./Category";
import { fmtHours, fmtPct } from "./format";
import { valueAt } from "@/store/select";

export interface NetworkMapProps {
  dataset: Dataset;
  analysis: Analysis;
  now: number;
  onOpen: (facilityId: string) => void;
}

/** Leaflet paints with real colour strings, so the tokens are read off :root (this file only loads in the browser). */
function readTokens(): Record<string, string> {
  const cs = getComputedStyle(document.documentElement);
  const get = (n: string) => cs.getPropertyValue(n).trim();
  return {
    surface: get("--surface-0"),
    line: get("--line-2"),
    ink1: get("--text-2"),
    ink2: get("--text-3"),
    pump_failure: get("--cat-failure-mark"),
    pipeline_leak: get("--cat-leak-mark"),
    pump_degradation: get("--cat-degradation-mark"),
    healthy: get("--ok-mark"),
  };
}

export function NetworkMap({ dataset, analysis, now, onOpen }: NetworkMapProps) {
  const [tok] = useState(readTokens);
  const points = useMemo(() => {
    const pts: [number, number][] = [];
    for (const s of dataset.network.systems) {
      pts.push([s.disposal_site.lat, s.disposal_site.lon], s.truck_yard);
      for (const f of s.facilities) pts.push([f.lat, f.lon]);
    }
    return pts;
  }, [dataset]);
  const byFacility = useMemo(() => {
    const m = new Map<string, typeof analysis.alerts>();
    for (const e of analysis.alerts) m.set(e.facility, [...(m.get(e.facility) ?? []), e]);
    return m;
  }, [analysis]);
  const yardIcon = useMemo(() => L.divIcon({ className: "", html: '<div class="yard-marker"></div>', iconSize: [10, 10], iconAnchor: [5, 5] }), []);

  return (
    <MapContainer center={points[0] ?? [0, 0]} zoom={8} className="h-full w-full" preferCanvas>
      {/* CARTO's dark_all tiles now watermark "API KEY REQUIRED" without a key; Esri's dark canvas is key-free.
          To go back to CARTO: url https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?api_key=… subdomains abcd. */}
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
        attribution="Tiles &copy; Esri, HERE, Garmin, OpenStreetMap contributors"
        maxZoom={16}
      />
      <FitBounds points={points} />

      {dataset.network.systems.map((sys) => {
        const hull = padHull(convexHull([[sys.disposal_site.lat, sys.disposal_site.lon], sys.truck_yard, ...sys.facilities.map((f) => [f.lat, f.lon] as [number, number])]));
        const fleet = analysis.fleet[sys.id];
        return (
          <Fragment key={sys.id}>
            <Polygon positions={hull} pathOptions={{ color: tok.line, weight: 1, fillColor: tok.line, fillOpacity: 0.08, opacity: 0.9 }} interactive={false} />
            {sys.facilities.map((f) => {
              const leak = (byFacility.get(f.id) ?? []).some((e) => e.category === "pipeline_leak");
              return (
                <Polyline
                  key={f.pipeline.id}
                  positions={[
                    [f.lat, f.lon],
                    [sys.disposal_site.lat, sys.disposal_site.lon],
                  ]}
                  pathOptions={{ color: leak ? tok.pipeline_leak : tok.line, weight: leak ? 2 : 1, opacity: leak ? 0.95 : 0.8 }}
                  interactive={false}
                />
              );
            })}
            <CircleMarker
              center={[sys.disposal_site.lat, sys.disposal_site.lon]}
              radius={5}
              pathOptions={{ color: tok.ink1, weight: 1.5, fillColor: tok.surface, fillOpacity: 1 }}
            >
              <Tooltip className="ops-tip" direction="top" offset={[0, -6]}>
                <span className="num font-semibold">{sys.disposal_site.id}</span>
                <br />
                Disposal site · <span className="num">{sys.disposal_site.pressure_psi} psi</span>
              </Tooltip>
            </CircleMarker>
            <Marker position={sys.truck_yard} icon={yardIcon}>
              <Tooltip className="ops-tip" direction="top" offset={[0, -6]}>
                <span className="num font-semibold">{sys.id} truck yard</span>
                <br />
                {fleet ? (
                  <span className="num">
                    {fleet.committed} of {fleet.size} trucks committed
                  </span>
                ) : (
                  "Fleet unknown"
                )}
              </Tooltip>
            </Marker>
            {sys.facilities.map((f) => {
              const evs = byFacility.get(f.id) ?? [];
              const worst = worstEvent(evs);
              const color = worst ? tok[worst.category] : tok.healthy;
              const level = valueAt(dataset, f.tank.id, "level_pct", now);
              const pumpStatus = valueAt(dataset, f.pump.id, "status", now);
              const htl = worst?.hours_to_limit?.p50;
              return (
                <Fragment key={f.id}>
                  {worst?.category === "pump_failure" && (
                    <CircleMarker center={[f.lat, f.lon]} radius={13} pathOptions={{ color, weight: 1.5, fill: false, opacity: 0.8 }} interactive={false} />
                  )}
                  <CircleMarker
                    center={[f.lat, f.lon]}
                    radius={worst ? 7 : 5}
                    pathOptions={{ color: tok.surface, weight: 1.5, fillColor: color, fillOpacity: 1 }}
                    eventHandlers={{ click: () => onOpen(f.id) }}
                  >
                    <Tooltip className="ops-tip" direction="top" offset={[0, -8]}>
                      <span className="num font-semibold">{f.id}</span>
                      <br />
                      Tank <span className="num">{fmtPct(level)}</span> · pump{" "}
                      <span className="num">{pumpStatus === 2 ? "fault" : pumpStatus === 1 ? "running" : pumpStatus === 0 ? "off" : "—"}</span>
                      {worst && (
                        <>
                          <br />
                          <span style={{ color: CATEGORY[worst.category].ink }}>{CATEGORY[worst.category].label}</span>
                          {htl != null && (
                            <>
                              {" "}
                              · shutdown in <span className="num">{fmtHours(htl)}</span>
                            </>
                          )}
                        </>
                      )}
                      <br />
                      <span className="text-ink-3">Click to open</span>
                    </Tooltip>
                  </CircleMarker>
                </Fragment>
              );
            })}
          </Fragment>
        );
      })}
    </MapContainer>
  );
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [28, 28] });
  }, [map, points]);
  return null;
}

/** Andrew's monotone chain on [lat, lon]. */
function convexHull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Push hull vertices ~12% away from the centroid so markers sit inside, not on, the outline. */
function padHull(h: [number, number][]): [number, number][] {
  if (h.length < 3) return h;
  const c = h.reduce((a, p) => [a[0] + p[0] / h.length, a[1] + p[1] / h.length], [0, 0]);
  return h.map(([la, lo]) => [c[0] + (la - c[0]) * 1.18, c[1] + (lo - c[1]) * 1.18]);
}
