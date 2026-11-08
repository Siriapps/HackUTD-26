import { analyse } from "@/lib/analyse";
import { listDatasets, loadDataset } from "@/lib/data/load";
import { seriesKey, type Analysis, type Dataset, type Event, type Facility, type Network, type Ops, type System } from "@/lib/data/types";
import { FIXTURES } from "@/lib/memory/fixture";

export interface Reading {
  asset: string;
  metric: string;
  value: number;
}

/** Everything one screen (or one Gemini briefing) needs about a single event. */
export interface EventContext {
  folder: string;
  now: number;
  event: Event;
  system: System;
  facility: Facility;
  limits: Network["defaults"]["tank_limits_pct"];
  ops: Ops;
  /** Facility readings at `now`, for "live readings" in the UI and the briefing. */
  readings: Reading[];
  /** Every event in the analysis, for incident memory. */
  events: Event[];
  fleet?: { size: number; committed: number };
}

export const findEvent = (analysis: Pick<Analysis, "events">, eventId: string) => analysis.events.find((e) => e.id === eventId);

export function readingsAt(dataset: Dataset, facility: Facility, now: number): Reading[] {
  let i = dataset.ts.length - 1;
  while (i > 0 && dataset.ts[i] > now) i--;
  const probes: Array<[string, string]> = [
    [facility.id, "inflow_bpd"],
    [facility.tank.id, "level_pct"],
    [facility.pump.id, "status"],
    [facility.pump.id, "flow_bpd"],
    [facility.pump.id, "discharge_psi"],
    [facility.pipeline.id, "receive_flow_bpd"],
    [facility.pipeline.id, "pressure_psi"],
    ...facility.wells.flatMap((w): Array<[string, string]> => [
      [w.id, "water_bpd"],
      [w.id, "status"],
    ]),
  ];
  return probes.flatMap(([asset, metric]) => {
    const value = dataset.series.get(seriesKey(asset, metric))?.[i];
    return value == null || Number.isNaN(value) ? [] : [{ asset, metric, value }];
  });
}

export function eventContext(dataset: Dataset, analysis: Analysis, event: Event): EventContext {
  const system =
    dataset.network.systems.find((s) => s.id === event.system) ??
    dataset.network.systems.find((s) => s.facilities.some((f) => f.id === event.facility));
  const facility = system?.facilities.find((f) => f.id === event.facility);
  if (!system || !facility) throw new Error(`${event.id}: facility ${event.facility} is not in network.json`);
  return {
    folder: dataset.folder,
    now: analysis.now,
    event,
    system,
    facility,
    limits: dataset.network.defaults.tank_limits_pct,
    ops: dataset.ops,
    readings: readingsAt(dataset, facility, analysis.now),
    events: analysis.events,
    fleet: analysis.fleet[system.id],
  };
}

const cache = new Map<string, Promise<{ dataset: Dataset; analysis: Analysis }>>();

/** Dataset + analysis for a folder, loaded and parsed once per page lifetime. */
export function loadAnalysis(folder: string) {
  let p = cache.get(folder);
  if (!p) {
    p = loadDataset(folder).then((dataset) => ({ dataset, analysis: analyse(dataset) }));
    p.catch(() => cache.delete(folder));
    cache.set(folder, p);
  }
  return p;
}

/**
 * One event with its surroundings. Fixture ids (FIX-*) resolve without a dataset so the field view works
 * before W1 lands; without a folder the first dataset listed by /api/datasets is used.
 */
export async function getEvent(eventId: string, folder?: string): Promise<EventContext | null> {
  const fixture = FIXTURES[eventId];
  if (fixture) return fixture;
  const f = folder || (await listDatasets())[0]?.folder;
  if (!f) return null;
  const { dataset, analysis } = await loadAnalysis(f);
  const event = findEvent(analysis, eventId);
  return event ? eventContext(dataset, analysis, event) : null;
}
