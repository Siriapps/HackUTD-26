import type { Dataset, EarlyWarning, Event } from "../data/types";
import type { FacilityCtx } from "../detect/events";
import raw from "./early_warning.json";
import { DEFAULT_WINDOW, facilityFeatures } from "./features";
import { CLASSES, classToCategory, predictProba, type EarlyWarningModel } from "./model";

export const model = raw as unknown as EarlyWarningModel;
export const modelTrained = () => model.version > 0 && model.weights.some((w) => w.some((v) => v !== 0));

/**
 * Score every facility at `nowIdx`. Returns early warnings for facilities where the model sees a
 * fault forming that the rules have not confirmed yet, and annotates ongoing drift events with
 * the model's probability (`ml_probability`). No-op when the model is untrained.
 */
export function earlyWarnings(ds: Dataset, ctxs: FacilityCtx[], nowIdx: number, events: Event[]): EarlyWarning[] {
  if (!modelTrained()) return [];
  const out: EarlyWarning[] = [];
  for (const ctx of ctxs) {
    const f = facilityFeatures(ds, ctx, nowIdx);
    if (!f) continue;
    const p = predictProba(model, f.x);
    const ongoing = events.filter((e) => e.facility === ctx.fac.id && e.status === "ongoing");
    for (const e of ongoing) {
      const k = CLASSES.indexOf(e.category as (typeof CLASSES)[number]);
      if (k > 0) e.ml_probability = p[k];
    }
    let best = 0;
    for (let k = 1; k < p.length; k++) if (p[k] > p[best]) best = k;
    const cat = classToCategory(CLASSES[best]);
    if (!cat || p[best] < model.threshold) continue;
    if (ongoing.some((e) => e.category === cat || e.category === "pump_failure")) continue;
    out.push({
      facility: ctx.fac.id,
      system: ctx.sys.id,
      asset: cat === "pipeline_leak" ? ctx.fac.pipeline.id : ctx.fac.pump.id,
      category: cat,
      probability: p[best],
      as_of_unix: f.lastRunUnix,
      note: `Learned scorer: ${(p[best] * 100).toFixed(0)} % ${cat === "pipeline_leak" ? "leak" : "wear"} signature over the last ${DEFAULT_WINDOW} running samples; rules have not confirmed yet`,
    });
  }
  return out.sort((a, b) => b.probability - a.probability);
}
