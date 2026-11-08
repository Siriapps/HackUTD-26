import { seriesKey, type Dataset, type Event, type Facility, type System } from "../data/types";
import { findDriftSegments, hingeOnset, stepOnset, type Segment } from "./drift";
import { lastIndexLE, robustBaseline, type Baseline } from "./stats";

export { lastIndexLE };

// Detector design parameters (statistical, not dataset values): rolling-window length in running
// samples, z-score trigger on the window mean, a floor on the relative drop so noise-free data
// cannot trigger on rounding, and consecutive windows required.
const LEAK = { window: 6, z: 5, minDrop: 0.01, persist: 2 };
const WEAR = { window: 12, z: 5, minDrop: 0.01, persist: 3 };
const H = 3600;

export interface FacilityCtx {
  sys: System;
  fac: Facility;
  st: Float64Array;
  fl: Float64Array;
  dp: Float64Array;
  rc: Float64Array;
  pp: Float64Array;
  lv: Float64Array;
  inf: Float64Array;
  wellStatus: Float64Array[];
}

export function facilityContexts(ds: Dataset): FacilityCtx[] {
  const get = (asset: string, metric: string) => ds.series.get(seriesKey(asset, metric)) ?? new Float64Array(ds.ts.length).fill(NaN);
  const out: FacilityCtx[] = [];
  for (const sys of ds.network.systems)
    for (const fac of sys.facilities)
      out.push({
        sys,
        fac,
        st: get(fac.pump.id, "status"),
        fl: get(fac.pump.id, "flow_bpd"),
        dp: get(fac.pump.id, "discharge_psi"),
        rc: get(fac.pipeline.id, "receive_flow_bpd"),
        pp: get(fac.pipeline.id, "pressure_psi"),
        lv: get(fac.tank.id, "level_pct"),
        inf: get(fac.id, "inflow_bpd"),
        wellStatus: fac.wells.map((w) => get(w.id, "status")),
      });
  return out;
}

type RawEvent = Omit<Event, "id">;

interface FacilitySamples {
  ctx: FacilityCtx;
  /** Sample indices (≤ nowIdx) where the pump is running. */
  run: number[];
  recv: number[];
  flow: number[];
  ppOff: number[];
  dpOff: number[];
}

interface Baselines {
  recv: Baseline | null;
  flow: Baseline | null;
  pp: Baseline | null;
  dp: Baseline | null;
}

export const fmtT = (unix: number) => new Date(unix * 1000).toISOString().slice(5, 16).replace("T", " ");
const n0 = (x: number) => Math.round(x).toLocaleString("en-US");
const pct = (x: number, d = 1) => (x * 100).toFixed(d);

function confidence(seg: Segment): number {
  // margin: how far the strongest window sits above the noise; persistence: windows seen.
  return Math.min(0.99, (1 - Math.exp(-seg.peakZ / 4)) * Math.min(1, 0.7 + seg.windows / 10));
}

/** Every event detectable from telemetry at or before sample `nowIdx`, onset order, ids assigned. */
export function detectEvents(ds: Dataset, nowIdx: number, ctxs: FacilityCtx[] = facilityContexts(ds)): Event[] {
  const dt = ds.ts.length > 1 ? ds.ts[1] - ds.ts[0] : 300;
  const per: FacilitySamples[] = ctxs.map((ctx) => {
    const run: number[] = [];
    for (let i = 0; i <= nowIdx; i++) if (ctx.st[i] === 1 && ctx.fl[i] > 0) run.push(i);
    const disp = ctx.sys.disposal_site.pressure_psi;
    return {
      ctx,
      run,
      recv: run.map((i) => ctx.rc[i] / ctx.fl[i]),
      flow: run.map((i) => ctx.fl[i] / ctx.fac.pump.max_flow_bpd),
      ppOff: run.map((i) => ctx.pp[i] - disp),
      dpOff: run.map((i) => ctx.dp[i] - disp),
    };
  });
  // Network-wide pooled baselines back up a facility that has not run long enough on its own.
  const pooled = {
    recv: robustBaseline(per.flatMap((p) => p.recv)),
    flow: robustBaseline(per.flatMap((p) => p.flow)),
    ppOff: robustBaseline(per.flatMap((p) => p.ppOff)),
    dpOff: robustBaseline(per.flatMap((p) => p.dpOff)),
  };
  const shift = (b: Baseline | null, by: number) => (b ? { ...b, m: b.m + by } : null);

  const raw: RawEvent[] = [];
  for (const p of per) {
    const disp = p.ctx.sys.disposal_site.pressure_psi;
    const b: Baselines = {
      recv: robustBaseline(p.recv) ?? pooled.recv,
      flow: robustBaseline(p.flow) ?? pooled.flow,
      pp: shift(robustBaseline(p.ppOff) ?? pooled.ppOff, disp),
      dp: shift(robustBaseline(p.dpOff) ?? pooled.dpOff, disp),
    };
    const fails = failures(ds, p.ctx, nowIdx, b);
    raw.push(...fails.events);
    if (b.recv) raw.push(...leaks(ds, p, nowIdx, b, dt));
    if (b.flow) raw.push(...wear(ds, p, nowIdx, b, fails.spans, dt));
  }
  raw.sort((a, c) => a.onset_unix - c.onset_unix || a.facility.localeCompare(c.facility));
  return raw.map((e, i) => ({ id: `EV-${String(i + 1).padStart(4, "0")}`, ...e }));
}

function base(ctx: FacilityCtx, asset: string, category: Event["category"], onset: number, end: number | null): RawEvent {
  return {
    system: ctx.sys.id,
    facility: ctx.fac.id,
    asset,
    category,
    onset_unix: onset,
    end_unix: end,
    status: end === null ? "ongoing" : "resolved",
    confidence: 0,
    evidence: [],
    actions: category === "pump_failure" ? [] : [{ type: "field_inspection", asset_id: asset }],
  };
}

function failures(ds: Dataset, ctx: FacilityCtx, nowIdx: number, b: Baselines) {
  const events: RawEvent[] = [];
  const spans: { start: number; end: number | null }[] = [];
  let i = 0;
  while (i <= nowIdx) {
    if (ctx.st[i] !== 2) {
      i++;
      continue;
    }
    const start = i;
    while (i <= nowIdx && ctx.st[i] === 2) i++;
    const end = i <= nowIdx ? i : null;
    const last = (end ?? nowIdx + 1) - 1;
    spans.push({ start, end });
    const e = base(ctx, ctx.fac.pump.id, "pump_failure", ds.ts[start], end === null ? null : ds.ts[end]);
    let prevRun = start - 1;
    while (prevRun >= 0 && ctx.st[prevRun] !== 1) prevRun--;
    const was = prevRun >= 0 ? `, was ${n0(ctx.fl[prevRun])} bpd` : "";
    e.evidence.push(`Pump status 2 (fault) since ${fmtT(ds.ts[start])}; flow ${n0(ctx.fl[last])} bpd${was}`);
    if (b.dp) e.evidence.push(`Discharge ${n0(ctx.dp[last])} psi has collapsed to disposal pressure (running baseline ${n0(b.dp.m)} psi)`);
    if (last > start) {
      const hrs = (ds.ts[last] - ds.ts[start]) / H;
      e.evidence.push(`Tank ${ctx.lv[start].toFixed(1)} % → ${ctx.lv[last].toFixed(1)} % in ${hrs.toFixed(1)} h (${((ctx.lv[last] - ctx.lv[start]) / hrs).toFixed(1)} pct/h)`);
    } else e.evidence.push(`Tank at ${ctx.lv[start].toFixed(1)} % with the pump down`);
    e.confidence = Math.min(0.99, 0.9 + 0.03 * (last - start));
    events.push(e);
  }
  return { events, spans };
}

function leaks(ds: Dataset, p: FacilitySamples, nowIdx: number, b: Baselines, dt: number): RawEvent[] {
  const { ctx, run } = p;
  const recv = b.recv!;
  const deficit = new Float64Array(ds.ts.length);
  run.forEach((idx, k) => (deficit[idx] = recv.m - p.recv[k]));
  const segs = findDriftSegments({ idx: run, deficit, sigma: recv.s, ...LEAK, endCap: null });
  const out: RawEvent[] = [];
  let prevEnd = -1;
  for (const seg of segs) {
    // Onset: matched-filter step on the summed z-scores of receive shortfall and pipeline pressure
    // drop, searched over running samples (3 h of pumping back, 1 h forward) since a window may
    // straddle an off period.
    const perHour = Math.max(1, Math.round(H / dt));
    const startPos = run.indexOf(seg.start);
    let lo = startPos;
    while (lo > 0 && run[lo - 1] > prevEnd && startPos - lo < 3 * perHour) lo--;
    let hi = startPos;
    while (hi + 1 < run.length && hi - startPos < perHour && (seg.end === null || run[hi + 1] < seg.end)) hi++;
    const z: number[] = [];
    for (let k = lo; k <= hi; k++) {
      let v = recv.s > 0 ? deficit[run[k]] / recv.s : deficit[run[k]] > 0 ? 1 : 0;
      if (b.pp && b.pp.s > 0) v += (b.pp.m - ctx.pp[run[k]]) / b.pp.s;
      z.push(v);
    }
    const onsetIdx = run[lo + stepOnset(z)];
    let lastPos = run.length - 1;
    if (seg.end !== null) while (lastPos > 0 && run[lastPos] >= seg.end) lastPos--;
    const last = run[lastPos];
    const e = base(ctx, ctx.fac.pipeline.id, "pipeline_leak", ds.ts[onsetIdx], seg.end === null ? null : ds.ts[seg.end]);
    e.evidence.push(`Receive flow ${n0(ctx.rc[last])} bpd is ${pct(1 - ctx.rc[last] / ctx.fl[last])} % below pump flow ${n0(ctx.fl[last])} bpd (healthy ratio ${recv.m.toFixed(3)} ± ${recv.s.toFixed(3)})`);
    if (b.pp) e.evidence.push(`Pipeline pressure ${n0(ctx.pp[last])} psi is ${n0(b.pp.m - ctx.pp[last])} psi below its running baseline ${n0(b.pp.m)} psi`);
    if (b.flow) e.evidence.push(`Pump delivers ${pct(ctx.fl[last] / ctx.fac.pump.max_flow_bpd)} % of rated flow, so the shortfall is downstream`);
    const pumpingH = ((lastPos - run.indexOf(onsetIdx) + 1) * dt) / H;
    e.evidence.push(`Shortfall has persisted for ${pumpingH.toFixed(1)} h of pumping since ${fmtT(ds.ts[onsetIdx])}`);
    e.confidence = confidence(seg);
    out.push(e);
    prevEnd = seg.end ?? nowIdx;
  }
  return out;
}

function wear(ds: Dataset, p: FacilitySamples, nowIdx: number, b: Baselines, failSpans: { start: number; end: number | null }[], dt: number): RawEvent[] {
  const { ctx, run } = p;
  const flow = b.flow!;
  const deficit = new Float64Array(ds.ts.length);
  run.forEach((idx, k) => (deficit[idx] = flow.m - p.flow[k]));
  const out: RawEvent[] = [];
  // A failure ends any wear in progress (two separate events), so detect per run between failures.
  let chunkStart = 0;
  let floorTs = -Infinity;
  const bounds = [...failSpans.map((s) => s.start), Infinity];
  for (let c = 0; c < bounds.length; c++) {
    let chunkEnd = chunkStart;
    while (chunkEnd < run.length && run[chunkEnd] < bounds[c]) chunkEnd++;
    const idx = run.slice(chunkStart, chunkEnd);
    const endCap = c < failSpans.length ? failSpans[c].start : null;
    let prevEndTs = floorTs;
    for (const seg of findDriftSegments({ idx, deficit, sigma: flow.s, ...WEAR, persist: WEAR.persist, endCap })) {
      const segEndTs = seg.end === null ? ds.ts[nowIdx] : ds.ts[seg.end];
      // Onset: joint hinge fit (flow ratio + discharge) back-extrapolates the ramp to the baseline.
      const fitLo = Math.max(ds.ts[seg.start] - 18 * H, prevEndTs);
      const fitHi = Math.min(segEndTs, ds.ts[seg.start] + 36 * H);
      const t: number[] = [];
      const yf: number[] = [];
      const yd: number[] = [];
      for (const i of idx) {
        if (ds.ts[i] < fitLo || ds.ts[i] > fitHi || (seg.end !== null && i >= seg.end)) continue;
        t.push(ds.ts[i]);
        yf.push(ctx.fl[i] / ctx.fac.pump.max_flow_bpd);
        yd.push(ctx.dp[i]);
      }
      // Candidates run from 12 h before the trigger up to the end of the first triggering window
      // (which may sit after an off period), on the sample grid.
      const startPos = idx.indexOf(seg.start);
      const candHi = ds.ts[idx[Math.min(startPos + WEAR.window - 1, idx.length - 1)]];
      const cands: number[] = [];
      for (let tc = candHi; tc >= Math.max(ds.ts[seg.start] - 12 * H, prevEndTs); tc -= dt) cands.push(tc);
      const chans = [{ y: yf, m: flow.m, s: flow.s }];
      if (b.dp) chans.push({ y: yd, m: b.dp.m, s: b.dp.s });
      const fit = t.length >= 6 && cands.length ? hingeOnset(t, chans, cands) : { t0: ds.ts[seg.start], slopes: [0] };
      const onset = Math.max(fit.t0, prevEndTs);
      let lastPos = idx.length - 1;
      if (seg.end !== null) while (lastPos > 0 && idx[lastPos] >= seg.end) lastPos--;
      const last = idx[lastPos];
      const e = base(ctx, ctx.fac.pump.id, "pump_degradation", onset, seg.end === null ? null : ds.ts[seg.end]);
      e.evidence.push(`Pump flow ${n0(ctx.fl[last])} bpd is ${pct(1 - ctx.fl[last] / ctx.fac.pump.max_flow_bpd)} % below rated ${n0(ctx.fac.pump.max_flow_bpd)} bpd (healthy ${pct(flow.m)} ± ${pct(flow.s)} %)`);
      if (b.dp) e.evidence.push(`Discharge ${n0(ctx.dp[last])} psi is ${n0(b.dp.m - ctx.dp[last])} psi below its running baseline ${n0(b.dp.m)} psi`);
      e.evidence.push(`Flow declining ${pct(-fit.slopes[0], 2)} %/h since ${fmtT(onset)} (ramp fit over ${t.length} running samples)`);
      if (b.recv) e.evidence.push(`Receive flow is ${pct(ctx.rc[last] / ctx.fl[last])} % of pump flow, so the pipeline is intact`);
      e.confidence = confidence(seg);
      out.push(e);
      prevEndTs = segEndTs;
    }
    chunkStart = chunkEnd;
    if (c < failSpans.length) floorTs = failSpans[c].end === null ? Infinity : ds.ts[failSpans[c].end!];
  }
  return out;
}
