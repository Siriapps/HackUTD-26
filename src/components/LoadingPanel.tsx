"use client";

import { useOps } from "@/store";

/**
 * Shown while telemetry.csv streams in, parses and gets analysed. It is the dashboard's own
 * skeleton (alerts · map · side), so the first 20 seconds already look like the console, with
 * the progress living where the alerts will appear.
 */
export function LoadingPanel() {
  const phase = useOps((s) => s.phase);
  const progress = useOps((s) => s.progress);
  const folder = useOps((s) => s.folder);
  const error = useOps((s) => s.error);
  const selectFolder = useOps((s) => s.selectFolder);
  const init = useOps((s) => s.init);

  const steps = [
    { key: "fetching", label: "Fetching telemetry.csv", detail: phase === "fetching" ? `${progress} %` : "" },
    { key: "parsing", label: "Parsing rows into sensor series", detail: "" },
    { key: "analysing", label: "Detecting events, pricing plans", detail: "" },
  ] as const;
  const order = ["idle", "listing", "fetching", "parsing", "analysing", "ready"] as const;
  const at = order.indexOf(phase as (typeof order)[number]);
  const state = (k: string) => {
    const i = order.indexOf(k as (typeof order)[number]);
    return at > i ? "done" : at === i ? "active" : "todo";
  };
  const pct = phase === "fetching" ? progress : phase === "parsing" || phase === "analysing" ? 100 : phase === "listing" || phase === "idle" ? 2 : 0;

  return (
    <div className="ops-dash p-3 box-border" aria-busy={phase !== "error"}>
      <section className="area-alerts panel flex flex-col min-h-0">
        <header className="panel-head">
          <h2 className="panel-title">Alerts</h2>
          <span className="panel-sub num">{folder ?? "console"}</span>
        </header>
        <div className="px-4 py-4">
          <div className="h-1 rounded bg-surface-3 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Loading">
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
          <ol className="mt-3 space-y-1.5 text-sm" aria-live="polite">
            {steps.map((s) => {
              const st = state(s.key);
              return (
                <li key={s.key} className={`flex items-center gap-2 ${st === "todo" ? "text-ink-3" : st === "active" ? "text-ink-1" : "text-ink-2"}`}>
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full"
                    style={{ background: st === "done" ? "var(--ok)" : st === "active" ? "var(--accent)" : "var(--line-2)" }}
                    aria-hidden
                  />
                  <span>{s.label}</span>
                  {s.detail && <span className="num text-ink-3 ml-auto">{s.detail}</span>}
                </li>
              );
            })}
          </ol>
          {phase === "error" && (
            <div className="mt-4 text-sm">
              <p style={{ color: "var(--shutdown)" }}>{error}</p>
              <button type="button" className="btn mt-3" onClick={() => (folder ? selectFolder(folder) : init())}>
                Try again
              </button>
            </div>
          )}
        </div>
        <ul className="px-4 space-y-3 opacity-60" aria-hidden>
          {[0, 1, 2].map((i) => (
            <li key={i} className="grid grid-cols-[44px_minmax(0,1fr)] gap-x-3">
              <span className="w-[44px] h-[44px] rounded-full border-[3px] border-line-2" />
              <span className="space-y-2 pt-1">
                <span className="block h-3 w-2/3 rounded bg-surface-3" />
                <span className="block h-5 w-1/3 rounded bg-surface-3" />
                <span className="block h-3 w-5/6 rounded bg-surface-2" />
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className="area-map panel grid place-items-center text-sm text-ink-3" aria-hidden>
        Map
      </section>
      <div className="area-side flex flex-col gap-3" aria-hidden>
        <section className="panel h-40" />
        <section className="panel flex-1" />
      </div>
    </div>
  );
}
