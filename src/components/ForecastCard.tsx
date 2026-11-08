import type { DegradationForecast } from "@/lib/data/types";

interface Props {
  forecast: DegradationForecast;
  /** Analysis.now (unix seconds). */
  now: number;
  /** ops.expected_repair_hours.pump_failure: the inspection must land one repair window before the failure. */
  repairHours: number;
  className?: string;
}

const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
export const fmtUtc = (unix: number) => `${dayFmt.format(unix * 1000)} UTC`;

export function fmtDuration(seconds: number): string {
  const h = seconds / 3600;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} h`;
  return `${(h / 24).toFixed(1)} days`;
}

/** "Fails in ~N days, inspect before <date>" for one worn pump. */
export function ForecastCard({ forecast, now, repairHours, className }: Props) {
  const fail = forecast.predicted_fail_unix;
  const drain = forecast.cannot_drain_unix;
  const first = [fail, drain].filter((x): x is number => x != null).sort((a, b) => a - b)[0];
  const inspectBy = first != null ? first - repairHours * 3600 : null;
  const pct = Math.round(forecast.confidence * 100);
  return (
    <article className={`rounded-md border border-line-1 bg-surface-2 p-3 ${className ?? ""}`} aria-label={`Forecast for ${forecast.pump_id}`}>
      <header className="flex items-center justify-between gap-2">
        <span className="num text-sm text-ink-1">{forecast.pump_id}</span>
        <span className="rounded-full bg-cat-degradation-soft px-2 py-0.5 text-xs font-medium text-cat-degradation">Pump degradation</span>
      </header>
      {fail != null ? (
        <p className="mt-2 text-base text-ink-1">
          Fails in <span className="num text-xl font-medium">~{fmtDuration(fail - now)}</span>
          <span className="text-ink-3"> · {fmtUtc(fail)}</span>
        </p>
      ) : (
        <p className="mt-2 text-base text-ink-2">Flow is low but not falling further; keep watching.</p>
      )}
      <dl className="num mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm text-ink-2">
        {inspectBy != null && (
          <>
            <dt className="font-sans text-ink-3">Inspect before</dt>
            <dd className={inspectBy <= now ? "text-shutdown" : "text-ink-1"}>{inspectBy <= now ? "now" : fmtUtc(inspectBy)}</dd>
          </>
        )}
        {drain != null && (
          <>
            <dt className="font-sans text-ink-3">Can&apos;t keep up with inflow</dt>
            <dd>{drain <= now ? "now" : `in ~${fmtDuration(drain - now)}`}</dd>
          </>
        )}
        <dt className="font-sans text-ink-3">Flow trend</dt>
        <dd>
          {(forecast.slope_per_hr * 100 * 24).toFixed(1)} % of max per day
          <span className="text-ink-3"> · {pct} % confidence</span>
        </dd>
      </dl>
    </article>
  );
}
