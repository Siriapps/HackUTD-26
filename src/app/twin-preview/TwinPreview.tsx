"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Twin3D, findFacility, readingsAt, type TwinTrucking } from "@/components/Twin3D";
import { analyse } from "@/lib/analyse";
import { listDatasets, loadDataset } from "@/lib/data/load";
import type { Category, Dataset, Event, Facility, LevelPoint, Plan } from "@/lib/data/types";

type Override = "auto" | Category;
const OVERRIDES: { value: Override; label: string }[] = [
  { value: "auto", label: "events from analyse()" },
  { value: "pump_failure", label: "force pump failure" },
  { value: "pipeline_leak", label: "force pipeline leak" },
  { value: "pump_degradation", label: "force pump degradation" },
];
const SPEEDS = [0.25, 1, 4, 12]; // dataset hours per real second
const STEP = 300;

const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ") + "Z";

/** Preview-only stand-in for a detector event so each visual can be checked before W1's analyse() lands. */
function syntheticEvent(ds: Dataset, facilityId: string, category: Category, t: number): Event {
  const found = findFacility(ds.network, facilityId)!;
  const { system, facility } = found;
  let onset = t - (category === "pump_failure" ? 3600 : category === "pipeline_leak" ? 6 * 3600 : 12 * 3600);
  if (category === "pump_failure") {
    // Walk back through the fault run so truck timing matches the real onset.
    const status = ds.series.get(`${facility.pump.id}|status`);
    if (status) {
      let i = ds.ts.length - 1;
      while (i > 0 && ds.ts[i] > t) i--;
      if (status[i] === 2) {
        while (i > 0 && status[i - 1] === 2) i--;
        onset = ds.ts[i];
      }
    }
  }
  const asset = category === "pipeline_leak" ? facility.pipeline.id : facility.pump.id;
  return {
    id: "PREVIEW",
    system: system.id,
    facility: facility.id,
    asset,
    category,
    onset_unix: onset,
    end_unix: null,
    status: "ongoing",
    confidence: 1,
    evidence: ["Preview override: not a detector result."],
    actions: category === "pump_failure" ? [] : [{ type: "field_inspection", asset_id: asset }],
  };
}

/**
 * Preview-only plan with a projected curve (inflow at Σ baseline water, truck slugs at arrivals, held at shutdown)
 * so the twin's plan replay can be checked. The real curve comes from W1's optimiser.
 */
function syntheticPlan(ds: Dataset, facility: Facility, event: Event, trucks: number, trips: number, trucking: TwinTrucking): Plan {
  const onset = event.onset_unix;
  const horizon = onset + ds.ops.expected_repair_hours.pump_failure * 3600;
  const cap = facility.tank.capacity_bbl;
  const risePerMin = (facility.wells.reduce((s, w) => s + w.baseline_water_bpd, 0) / 24 / 60 / cap) * 100;
  const slug = ((trucks * ds.ops.emergency_trucking.truck_capacity_bbl) / cap) * 100;
  const arrivals = new Set(Array.from({ length: trips }, (_, k) => trucking.response_min + k * trucking.cycle_min));
  const shutdown = ds.network.defaults.tank_limits_pct.shutdown;
  let level = readingsAt(ds, facility, onset).level_pct;
  let peak = level;
  const curve: LevelPoint[] = [];
  for (let m = 0; m <= (horizon - onset) / 60; m++) {
    if (arrivals.has(m)) level = Math.max(0, level - slug);
    curve.push({ t_unix: onset + m * 60, level_pct: level });
    peak = Math.max(peak, level);
    if (level < shutdown) level = Math.min(shutdown, level + risePerMin);
  }
  return {
    recommended: {
      label: `${trucks} truck${trucks > 1 ? "s" : ""}, ${trips} trip${trips > 1 ? "s" : ""}`,
      actions: [{ type: "dispatch_truck", facility_id: event.facility, trucks, trips_per_truck: trips }],
      cost: trucks * trips * ds.ops.emergency_trucking.cost_per_trip,
      feasible: peak < shutdown,
      peak_level_pct: peak,
      trips_at_unix: null,
      curve,
    },
    alternatives: [],
    trucks_used: trucks,
    horizon_end_unix: horizon,
  };
}

export function TwinPreview() {
  const params = useSearchParams();
  const [folders, setFolders] = useState<string[]>([]);
  const [folder, setFolder] = useState(params.get("folder") ?? "");
  const [ds, setDs] = useState<Dataset | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [facilityId, setFacilityId] = useState(params.get("facility") ?? "");
  const [t, setT] = useState(Number(params.get("t")) || 0);
  const [playing, setPlaying] = useState(params.get("play") === "1");
  const [speed, setSpeed] = useState(Number(params.get("speed")) || 1);
  const [override, setOverride] = useState<Override>((params.get("event") as Override) || "auto");
  const [planSpec, setPlanSpec] = useState(params.get("plan") ?? "");

  const pickFolder = (f: string) => {
    setFolder(f);
    setDs(null);
    setProgress(0);
  };

  useEffect(() => {
    listDatasets()
      .then((list) => {
        const names = list.map((d) => d.folder);
        setFolders(names);
        setFolder((f) => f || names[0] || "");
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!folder) return;
    let cancelled = false;
    loadDataset(folder, setProgress)
      .then((d) => {
        if (cancelled) return;
        setDs(d);
        setFacilityId((id) => (findFacility(d.network, id) ? id : d.network.systems[0]?.facilities[0]?.id ?? ""));
        setT((cur) => (cur >= d.ts[0] && cur <= d.now ? cur : d.now));
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [folder]);

  // Keep the URL shareable (no navigation).
  useEffect(() => {
    if (!ds) return;
    const q = new URLSearchParams({ folder, facility: facilityId, t: String(t), event: override });
    if (planSpec) q.set("plan", planSpec);
    if (speed !== 1) q.set("speed", String(speed));
    window.history.replaceState(null, "", `?${q}`);
  }, [ds, folder, facilityId, t, override, planSpec, speed]);

  // Playback: advance dataset time at `speed` hours per second, stop at "now".
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  useEffect(() => {
    if (!playing || !ds) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const next = Math.min(ds.now, tRef.current + dt * speed * 3600);
      setT(next);
      if (next >= ds.now) setPlaying(false);
      else raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, ds]);

  // analyse() is the single analytics entry point; run it on a settled time, never per animation frame.
  const [tSettled, setTSettled] = useState(t);
  useEffect(() => {
    const h = setTimeout(() => setTSettled(t), 400);
    return () => clearTimeout(h);
  }, [t]);
  const analysis = useMemo(() => (ds ? analyse(ds, tSettled) : null), [ds, tSettled]);

  const found = ds ? findFacility(ds.network, facilityId) : null;
  const readings = ds && found ? readingsAt(ds, found.facility, t) : null;
  const detected = analysis?.events.find((e) => e.facility === facilityId && e.onset_unix <= t && (e.end_unix == null || t < e.end_unix));
  const event = ds && found && override !== "auto" ? syntheticEvent(ds, facilityId, override, t) : detected;
  const trucking = ds && found ? ds.ops.systems[found.system.id]?.facilities[found.facility.id] : undefined;
  let plan = detected?.plan;
  if (ds && found && trucking && event && event.category === "pump_failure" && planSpec) {
    const [trucks, trips] = planSpec.split("x").map((n) => Math.max(1, Number(n) || 1));
    plan = syntheticPlan(ds, found.facility, event, trucks, trips ?? 1, trucking);
  }

  const select = "rounded-sm border border-line-1 bg-surface-2 px-2 py-1 text-sm text-ink-1";
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-3 p-4" data-ready={ds && readings ? "1" : "0"}>
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-lg font-semibold tracking-tight">Twin preview</h1>
        <select className={select} value={folder} onChange={(e) => pickFolder(e.target.value)} aria-label="Dataset folder">
          {folders.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
        <select className={select} value={facilityId} onChange={(e) => setFacilityId(e.target.value)} aria-label="Facility" disabled={!ds}>
          {ds?.network.systems.flatMap((s) => s.facilities.map((f) => <option key={f.id}>{f.id}</option>))}
        </select>
        <select className={select} value={override} onChange={(e) => setOverride(e.target.value as Override)} aria-label="Event override">
          {OVERRIDES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-sm text-ink-2">
          plan
          <input
            className={`${select} w-16`}
            value={planSpec}
            onChange={(e) => setPlanSpec(e.target.value)}
            placeholder="1x1"
            aria-label="Synthetic truck plan, trucks x trips"
          />
        </label>
        <button
          type="button"
          className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-surface-0 hover:bg-accent-hover disabled:opacity-50"
          onClick={() => setPlaying((p) => !p)}
          disabled={!ds}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <select className={select} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s} h/s
            </option>
          ))}
        </select>
        <span className="num ml-auto text-sm text-ink-2">{ds ? iso(t) : "—"}</span>
      </header>

      {error && <p className="rounded-md border border-shutdown/40 bg-shutdown-soft px-3 py-2 text-sm text-shutdown">{error}</p>}

      {ds && found && readings ? (
        <Twin3D
          facility={found.facility}
          readings={readings}
          limits={ds.network.defaults.tank_limits_pct}
          t={t}
          event={event}
          plan={plan}
          trucking={trucking}
          height={520}
        />
      ) : (
        <div className="flex h-[520px] items-center justify-center rounded-lg border border-line-1 bg-surface-1 text-sm text-ink-3">
          {error ? "The dataset did not load; pick another folder or check the server log." : `Getting ${folder || "the dataset list"}… ${progress}%`}
        </div>
      )}

      {ds && (
        <div className="flex flex-col gap-1">
          <input
            type="range"
            min={ds.ts[0]}
            max={ds.now}
            step={STEP}
            value={t}
            onChange={(e) => setT(Number(e.target.value))}
            aria-label="Displayed time"
            className="w-full"
          />
          <div className="num flex justify-between text-xs text-ink-3">
            <span>{iso(ds.ts[0])}</span>
            <span>{iso(ds.now)}</span>
          </div>
        </div>
      )}

      {ds && event && (
        <p className="text-sm text-ink-2">
          <span className="num text-ink-1">{event.id}</span> {event.category} at {event.asset}, onset <span className="num">{iso(event.onset_unix)}</span>
          {plan && (
            <>
              {" "}
              · plan {plan.recommended.label}, <span className="num">${plan.recommended.cost.toLocaleString()}</span>
            </>
          )}
        </p>
      )}
    </main>
  );
}
