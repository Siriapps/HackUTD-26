import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { analyse } from "@/lib/analyse";
import { listDatasets, loadDataset, type DatasetInfo } from "@/lib/data/load";
import type { Analysis, Dataset, Event } from "@/lib/data/types";
import { FIXTURE_ENABLED, fixtureAnalysis } from "./fixture";

export type Phase = "idle" | "listing" | "fetching" | "parsing" | "analysing" | "ready" | "error";
export type Source = "analyse" | "fixture";

/** One alert firing during replay: the pipeline the operator watches run. */
export interface Fired {
  eventId: string;
  facility: string;
  category: Event["category"];
  /** Dataset time the alert appeared. */
  atUnix: number;
  /** Wall-clock ms when it fired (drives the staged reveal). */
  firedAt: number;
  priced: boolean;
  /** null = not attempted, "sending" | "sent" | "dry" | "failed". */
  text: null | "sending" | "sent" | "dry" | "failed";
  textNote?: string;
}

interface OpsState {
  folders: DatasetInfo[];
  folder: string | null;
  dataset: Dataset | null;
  phase: Phase;
  /** 0..100 while fetching telemetry.csv */
  progress: number;
  error: string | null;
  /** Time travel: null = the folder's own "now". */
  nowOverride: number | null;
  analysis: Analysis | null;
  /** Analysis at the folder's real "now" (hindsight for the timeline); unaffected by time travel. */
  fullAnalysis: Analysis | null;
  source: Source | null;
  /** Replay: the console clock advances by itself at `speed` dataset-seconds per real second. */
  playing: boolean;
  speed: number;
  /** Fired alerts text the on-call tech automatically (kill switch in the top bar). */
  autoText: boolean;
  fired: Fired[];
  init: () => Promise<void>;
  selectFolder: (folder: string) => Promise<void>;
  setNow: (t: number | null, opts?: { playback?: boolean }) => void;
  setPlaying: (on: boolean) => void;
  setSpeed: (s: number) => void;
  setAutoText: (on: boolean) => void;
  /** Advance the clock by `dtSec` dataset seconds (replay ticker). */
  tick: (dtSec: number) => void;
  clearFired: () => void;
}

/** analyse() runs here, once per (dataset, nowOverride); never in render. */
function compute(dataset: Dataset, nowOverride: number | null): { analysis: Analysis; source: Source } {
  const real = analyse(dataset, nowOverride ?? undefined);
  if (FIXTURE_ENABLED && real.events.length === 0) {
    const fx = fixtureAnalysis(dataset, real.now);
    if (fx) return { analysis: fx, source: "fixture" };
  }
  return { analysis: real, source: "analyse" };
}

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Text the on-call tech for a freshly fired alert through P3's dispatch route; record what happened. */
async function textFired(r: Fired, folder: string, asOf: number) {
  const patch = (p: Partial<Fired>) => useOps.setState((s) => ({ fired: s.fired.map((f) => (f.eventId === r.eventId && f.firedAt === r.firedAt ? { ...f, ...p } : f)) }));
  patch({ text: "sending" });
  try {
    const res = await fetch("/api/dispatch/alert", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventId: r.eventId, folder, asOf, replayId: r.firedAt }) });
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; dryRun?: boolean; reason?: string; error?: string; message?: string; to?: string };
    if (!res.ok || j.ok === false) patch({ text: "failed", textNote: j.error ?? j.reason ?? `${res.status}` });
    else patch({ text: j.dryRun || j.reason ? "dry" : "sent", textNote: j.reason ?? j.message ?? j.to });
  } catch (e) {
    patch({ text: "failed", textNote: msg(e) });
  }
}
const nextFrame = () => new Promise<void>((r) => setTimeout(r, 0));
const noopStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
let loadSeq = 0;

export const useOps = create<OpsState>()(
  persist(
    (set, get) => ({
      folders: [],
      folder: null,
      dataset: null,
      phase: "idle",
      progress: 0,
      error: null,
      nowOverride: null,
      analysis: null,
      fullAnalysis: null,
      source: null,
      playing: false,
      speed: 600,
      autoText: true,
      fired: [],

      async init() {
        if (get().phase !== "idle") return;
        set({ phase: "listing", error: null });
        try {
          const folders = await listDatasets();
          set({ folders });
          // A deep link (?folder=) wins over the folder remembered from last time.
          const fromUrl = typeof location !== "undefined" ? new URLSearchParams(location.search).get("folder") : null;
          const wanted = fromUrl && folders.some((f) => f.folder === fromUrl) ? fromUrl : get().folder;
          const pick = folders.find((f) => f.folder === wanted)?.folder ?? folders[0]?.folder ?? null;
          if (!pick) {
            set({ phase: "error", error: "No dataset folders found under public/data." });
            return;
          }
          await get().selectFolder(pick);
        } catch (err) {
          set({ phase: "error", error: msg(err) });
        }
      },

      async selectFolder(folder) {
        const seq = ++loadSeq;
        // A scrubbed "now" only makes sense for the folder it was set on.
        const keepNow = folder === get().folder ? get().nowOverride : null;
        set({
          folder,
          phase: "fetching",
          progress: 0,
          error: null,
          dataset: null,
          analysis: null,
          fullAnalysis: null,
          source: null,
          nowOverride: keepNow,
        });
        try {
          const dataset = await loadDataset(folder, (pct) => {
            if (seq === loadSeq) set({ progress: pct, phase: pct >= 100 ? "parsing" : "fetching" });
          });
          if (seq !== loadSeq) return;
          set({ phase: "analysing", dataset });
          await nextFrame();
          let nowOverride = get().nowOverride;
          if (nowOverride != null && (nowOverride < dataset.ts[0] || nowOverride >= dataset.now)) nowOverride = null;
          const full = compute(dataset, null);
          const { analysis, source } = nowOverride == null ? full : compute(dataset, nowOverride);
          if (seq !== loadSeq) return;
          set({ analysis, fullAnalysis: full.analysis, source, nowOverride, phase: "ready" });
        } catch (err) {
          if (seq === loadSeq) set({ phase: "error", error: msg(err) });
        }
      },

      setNow(t, opts) {
        const { dataset, analysis: prev } = get();
        if (!dataset) return;
        const nowOverride = t == null || t >= dataset.now ? null : Math.max(dataset.ts[0], Math.round(t / 300) * 300);
        try {
          const { analysis, source } = compute(dataset, nowOverride);
          set({ nowOverride, analysis, source, error: null });
          // Firing: alerts that are in progress now and were not a moment ago (forward moves only).
          // A scrub across the week does not text every alert it passes. Playback does, however
          // far one frame jumps, so a replay cannot skip a firing.
          const span = prev ? analysis.now - prev.now : 0;
          if (prev && span > 0 && (opts?.playback || span <= 2 * 3600)) {
            const before = new Set(prev.alerts.map((e) => e.id));
            const fresh = analysis.alerts.filter((e) => !before.has(e.id));
            if (fresh.length) {
              const firedAt = Date.now();
              const recs: Fired[] = fresh.map((e) => ({ eventId: e.id, facility: e.facility, category: e.category, atUnix: analysis.now, firedAt, priced: true, text: null }));
              set({ fired: [...recs, ...get().fired].slice(0, 12) });
              if (get().autoText) for (const r of recs) void textFired(r, dataset.folder, analysis.now);
            }
          }
        } catch (err) {
          set({ error: msg(err) });
        }
      },

      setPlaying(on) {
        set({ playing: on });
      },
      setSpeed(speed) {
        set({ speed });
      },
      setAutoText(on) {
        set({ autoText: on });
      },
      tick(dtSec) {
        const { dataset, nowOverride, playing } = get();
        if (!dataset || !playing) return;
        const cur = nowOverride ?? dataset.now;
        if (cur >= dataset.now) {
          set({ playing: false });
          return;
        }
        const next = Math.min(dataset.now, cur + dtSec);
        // Only re-analyse when the clock crosses a 5-minute grid line.
        if (Math.floor(next / 300) !== Math.floor(cur / 300)) get().setNow(next, { playback: true });
        else set({ nowOverride: next });
      },
      clearFired() {
        set({ fired: [] });
      },
    }),
    {
      name: "avon-ops",
      storage: createJSONStorage(() => (typeof window === "undefined" ? noopStorage : window.localStorage)),
      partialize: (s) => ({ folder: s.folder, nowOverride: s.nowOverride }),
    },
  ),
);
