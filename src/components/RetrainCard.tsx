import calibration from "@/lib/calibration/calibration.json";
import model from "@/lib/ml/early_warning.json";
import { InfoTip } from "./InfoTip";

const when = (iso: string) => new Date(iso).toUTCString().replace(":00 GMT", " UTC").replace(/^\w+, /, "");

/** Is the model retrained? The honest answer, from the artefacts the nightly job writes. */
export function RetrainCard() {
  const cal = calibration as { generated_at: string; detect: { leak: { ratio_threshold: number }; degradation: { ratio_threshold: number } }; forecast: { fail_ratio_band: number }; provenance: { outcomes: number; folders: string[]; verdicts: { confirmed: number; dismissed: number } } };
  const m = model as { trained_at: string; metrics: { false_positive_rate: number; recall: { pipeline_leak: number; pump_degradation: number }; median_lead_min: number | null } | null; provenance: { real_windows: number; synthetic_windows: number } };
  return (
    <section className="panel">
      <header className="panel-head">
        <h2 className="panel-title flex items-center gap-1.5">
          Learning loop <InfoTip title="What retrains, and what does not">{"Plans and costs are physics and never change. What learns: (1) detector thresholds and the forecast's pre-failure band are refit nightly from every resolved event's outcome; (2) the early-warning scorer, a logistic model on window features, is retrained on real windows plus synthetic ones generated from the physics; (3) technician confirm/dismiss verdicts nudge per-category confidence. The nightly GitHub Action writes these files and opens a pull request."}</InfoTip>
        </h2>
        <span className="panel-sub">nightly · opens a PR</span>
      </header>
      <dl className="px-4 py-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-ink-3">Last recalibration</dt>
        <dd className="num text-ink-1">
          {when(cal.generated_at)} · from <strong>{cal.provenance.outcomes}</strong> resolved outcomes across {cal.provenance.folders.length} folders
        </dd>
        <dt className="text-ink-3">Detector thresholds</dt>
        <dd className="num text-ink-1">
          leak {Math.round(cal.detect.leak.ratio_threshold * 1000) / 10} % · wear {Math.round(cal.detect.degradation.ratio_threshold * 1000) / 10} % below baseline
        </dd>
        <dt className="text-ink-3">Forecast fail band</dt>
        <dd className="num text-ink-1">{(cal.forecast.fail_ratio_band * 100).toFixed(1)} % of rated flow, learned from this data&apos;s own wear→failure pairs</dd>
        <dt className="text-ink-3">Early-warning scorer</dt>
        <dd className="num text-ink-1">
          trained {when(m.trained_at)} on {m.provenance.real_windows.toLocaleString("en-US")} real + {m.provenance.synthetic_windows.toLocaleString("en-US")} synthetic windows
          {m.metrics && (
            <>
              {" "}
              · held-out false alarms <strong>{(m.metrics.false_positive_rate * 100).toFixed(2)} %</strong> · recall leak {Math.round(m.metrics.recall.pipeline_leak * 100)} % / wear {Math.round(m.metrics.recall.pump_degradation * 100)} %
            </>
          )}
        </dd>
        <dt className="text-ink-3">Technician verdicts</dt>
        <dd className="num text-ink-1">
          {cal.provenance.verdicts.confirmed} confirmed · {cal.provenance.verdicts.dismissed} dismissed (each night&apos;s close-outs feed the next run)
        </dd>
      </dl>
    </section>
  );
}
