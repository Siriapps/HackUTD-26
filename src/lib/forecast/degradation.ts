import { seriesKey, type Dataset, type DegradationForecast, type Event, type Facility } from "@/lib/data/types";

/**
 * Degradation → failure forecast. For each ongoing pump_degradation event, fit a line to the running-flow ratio
 * (flow_bpd / max_flow_bpd while the pump runs) since onset and project:
 *  - cannot_drain_unix: ratio reaches Σ baseline_water_bpd / max_flow_bpd (pump slower than inflow);
 *  - predicted_fail_unix: ratio reaches the band seen just before this dataset's own wear-related pump failures,
 *    or FALLBACK_FAIL_RATIO when the dataset has none yet.
 * Everything else (noise, healthy baseline, failure band) is derived from the loaded folder.
 */

/** Modelling prior, used only when the dataset holds no wear-related failure to learn the band from. */
export const FALLBACK_FAIL_RATIO = 0.85;
/** Running samples used to characterise a pump just before it failed (3 h at 5-min cadence). */
const PRE_FAIL_SAMPLES = 36;
/** A decline counts as real when it exceeds this many noise sigmas over the fitted window. */
const SIGNIFICANCE_SIGMAS = 3;

export interface RatioFit {
  /** Ratio change per hour (negative = wearing). */
  slope_per_hr: number;
  /** Fitted ratio at `from`. */
  intercept: number;
  r2: number;
  n: number;
  first_unix: number;
  last_unix: number;
}

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function pumpSeries(ds: Dataset, pumpId: string) {
  return { flow: ds.series.get(seriesKey(pumpId, "flow_bpd")), status: ds.series.get(seriesKey(pumpId, "status")) };
}

const isRunning = (status: Float64Array | undefined, flow: Float64Array, i: number) =>
  flow[i] > 0 && (status ? status[i] === 1 : true);

function pumpsOf(ds: Dataset): { facility: Facility; maxFlow: number }[] {
  return ds.network.systems.flatMap((s) => s.facilities.map((facility) => ({ facility, maxFlow: facility.pump.max_flow_bpd })));
}

/** Least-squares line through (hours since `from`, running-flow ratio) for samples in [from, to]. */
export function fitRunningRatio(ds: Dataset, pumpId: string, maxFlow: number, from: number, to: number): RatioFit | null {
  const { flow, status } = pumpSeries(ds, pumpId);
  if (!flow || !(maxFlow > 0)) return null;
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let first = -1;
  let last = -1;
  for (let i = 0; i < ds.ts.length; i++) {
    const t = ds.ts[i];
    if (t < from) continue;
    if (t > to) break;
    if (!isRunning(status, flow, i)) continue;
    const x = (t - from) / 3600;
    const y = flow[i] / maxFlow;
    n++;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
    if (first < 0) first = t;
    last = t;
  }
  if (n < 3) return null;
  const den = n * sxx - sx * sx;
  if (den === 0) return null;
  const slope = (n * sxy - sx * sy) / den;
  const intercept = (sy - slope * sx) / n;
  const ssTot = syy - (sy * sy) / n;
  const ssRes = syy - intercept * sy - slope * sxy;
  const r2 = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;
  return { slope_per_hr: slope, intercept, r2, n, first_unix: first, last_unix: last };
}

/** Healthy running-ratio baseline and noise (median / 1.4826·MAD over every pump's running samples up to `now`). */
export function healthyBand(ds: Dataset, now: number): { median: number; sigma: number } {
  const ratios: number[] = [];
  for (const { facility, maxFlow } of pumpsOf(ds)) {
    const { flow, status } = pumpSeries(ds, facility.pump.id);
    if (!flow) continue;
    for (let i = 0; i < ds.ts.length && ds.ts[i] <= now; i++) if (isRunning(status, flow, i)) ratios.push(flow[i] / maxFlow);
  }
  const med = median(ratios);
  const mad = median(ratios.map((r) => Math.abs(r - med)));
  return { median: med, sigma: 1.4826 * mad };
}

/**
 * Running-flow ratio just before each wear-related pump failure (status → 2) that happened at or before `now`:
 * the median of the last PRE_FAIL_SAMPLES running samples, kept only when it sits clearly below the healthy band.
 * Sudden failures of healthy pumps say nothing about wear and are ignored. Null when there are none.
 */
export function failureBand(ds: Dataset, now: number): { ratio: number; samples: number } | null {
  const healthy = healthyBand(ds, now);
  const cutoff = healthy.median - Math.max(0.01, 5 * healthy.sigma);
  const pre: number[] = [];
  for (const { facility, maxFlow } of pumpsOf(ds)) {
    const { flow, status } = pumpSeries(ds, facility.pump.id);
    if (!flow || !status) continue;
    for (let i = 1; i < ds.ts.length && ds.ts[i] <= now; i++) {
      if (!(status[i] === 2 && status[i - 1] !== 2)) continue;
      const window: number[] = [];
      for (let j = i - 1; j >= 0 && window.length < PRE_FAIL_SAMPLES; j--) if (isRunning(status, flow, j)) window.push(flow[j] / maxFlow);
      const m = median(window);
      if (Number.isFinite(m) && m < cutoff) pre.push(m);
    }
  }
  return pre.length ? { ratio: median(pre), samples: pre.length } : null;
}

function projectTo(fit: RatioFit, from: number, now: number, target: number): number | null {
  if (fit.slope_per_hr >= 0) return null;
  const ratioNow = fit.intercept + (fit.slope_per_hr * (now - from)) / 3600;
  if (ratioNow <= target) return now;
  return Math.round(now + ((target - ratioNow) / fit.slope_per_hr) * 3600);
}

/** Forecasts for the ongoing pump_degradation events in `events` as of `now` (fills `Analysis.forecasts`). */
export function forecastDegradation(ds: Dataset, events: Event[], now: number): DegradationForecast[] {
  const worn = events.filter((e) => e.category === "pump_degradation" && e.onset_unix <= now && (e.end_unix == null || now < e.end_unix));
  if (!worn.length) return [];
  const healthy = healthyBand(ds, now);
  const band = failureBand(ds, now)?.ratio ?? FALLBACK_FAIL_RATIO;
  const out: DegradationForecast[] = [];
  for (const e of worn) {
    const f = pumpsOf(ds).find((p) => p.facility.pump.id === e.asset || p.facility.id === e.facility);
    if (!f) continue;
    const fit = fitRunningRatio(ds, f.facility.pump.id, f.maxFlow, e.onset_unix, now);
    if (!fit) continue;
    const hours = (fit.last_unix - fit.first_unix) / 3600;
    const decline = -fit.slope_per_hr * hours;
    const significant = fit.slope_per_hr < 0 && decline > SIGNIFICANCE_SIGMAS * Math.max(healthy.sigma, 1e-4);
    const inflow = f.facility.wells.reduce((s, w) => s + w.baseline_water_bpd, 0);
    out.push({
      pump_id: f.facility.pump.id,
      facility: f.facility.id,
      slope_per_hr: fit.slope_per_hr,
      cannot_drain_unix: significant ? projectTo(fit, e.onset_unix, now, inflow / f.maxFlow) : null,
      predicted_fail_unix: significant ? projectTo(fit, e.onset_unix, now, band) : null,
      confidence: significant ? Math.min(1, fit.r2 * Math.min(1, fit.n / PRE_FAIL_SAMPLES)) : 0,
    });
  }
  return out;
}
