"use client";

import { useOps } from "@/store";

/** Shown while telemetry.csv streams in (progress from loadDataset), parses and gets analysed. */
export function LoadingPanel() {
  const phase = useOps((s) => s.phase);
  const progress = useOps((s) => s.progress);
  const folder = useOps((s) => s.folder);
  const error = useOps((s) => s.error);
  const selectFolder = useOps((s) => s.selectFolder);
  const init = useOps((s) => s.init);

  const label =
    phase === "listing"
      ? "Listing dataset folders"
      : phase === "fetching"
        ? `Fetching telemetry.csv · ${progress}%`
        : phase === "parsing"
          ? "Parsing rows into series"
          : phase === "analysing"
            ? "Detecting events and pricing plans"
            : phase === "error"
              ? "Could not load the folder"
              : "Starting";
  const pct = phase === "fetching" ? progress : phase === "listing" || phase === "idle" ? 2 : phase === "parsing" ? 100 : phase === "analysing" ? 100 : 0;

  return (
    <div className="h-full grid place-items-center">
      <div className="w-[420px] max-w-full">
        <p className="text-ink-3 text-sm">Loading</p>
        <h1 className="num text-xl font-semibold mt-0.5">{folder ?? "console"}</h1>
        <div className="mt-4 h-1 rounded bg-surface-3 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
          <div
            className="h-full rounded"
            style={{
              width: `${pct}%`,
              background: phase === "error" ? "var(--shutdown)" : "var(--accent)",
              transition: "width 200ms ease-out",
              animation: phase === "parsing" || phase === "analysing" ? "pulse 1.2s ease-in-out infinite" : undefined,
            }}
          />
        </div>
        <p className="mt-2 text-sm text-ink-2" aria-live="polite">
          {label}
        </p>
        {phase === "error" && (
          <div className="mt-3 text-sm">
            <p className="text-shutdown">{error}</p>
            <button type="button" className="btn mt-3" onClick={() => (folder ? selectFolder(folder) : init())}>
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
