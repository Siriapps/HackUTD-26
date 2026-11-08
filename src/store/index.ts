import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { analyse } from "@/lib/analyse";
import { listDatasets, loadDataset, type DatasetInfo } from "@/lib/data/load";
import type { Analysis, Dataset } from "@/lib/data/types";
import { FIXTURE_ENABLED, fixtureAnalysis } from "./fixture";

export type Phase = "idle" | "listing" | "fetching" | "parsing" | "analysing" | "ready" | "error";
export type Source = "analyse" | "fixture";

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
  init: () => Promise<void>;
  selectFolder: (folder: string) => Promise<void>;
  setNow: (t: number | null) => void;
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

      async init() {
        if (get().phase !== "idle") return;
        set({ phase: "listing", error: null });
        try {
          const folders = await listDatasets();
          set({ folders });
          const wanted = get().folder;
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

      setNow(t) {
        const { dataset } = get();
        if (!dataset) return;
        const nowOverride = t == null || t >= dataset.now ? null : Math.max(dataset.ts[0], Math.round(t / 300) * 300);
        try {
          const { analysis, source } = compute(dataset, nowOverride);
          set({ nowOverride, analysis, source, error: null });
        } catch (err) {
          set({ error: msg(err) });
        }
      },
    }),
    {
      name: "avon-ops",
      storage: createJSONStorage(() => (typeof window === "undefined" ? noopStorage : window.localStorage)),
      partialize: (s) => ({ folder: s.folder, nowOverride: s.nowOverride }),
    },
  ),
);
