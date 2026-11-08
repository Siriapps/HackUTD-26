import type { Severity, VisualReport } from "@/lib/memory/incidents";

const SEVERITY: Record<Severity, { label: string; color: string }> = {
  low: { label: "Low severity", color: "var(--green, #34d399)" },
  medium: { label: "Medium severity", color: "var(--amber, #f5a524)" },
  high: { label: "High severity", color: "var(--red, #fb7185)" },
  critical: { label: "Critical", color: "var(--red, #fb7185)" },
};

const when = (ms: number) => new Date(ms).toISOString().slice(11, 16) + " UTC";

/**
 * One visual report from the camera (PLAN item 18). Self-contained styling via CSS variables with fallbacks,
 * so W2 can drop it into /admin outside the `.field` scope.
 */
export default function VisualReportCard({ report, compact = false }: { report: VisualReport; compact?: boolean }) {
  const sev = SEVERITY[report.severity] ?? SEVERITY.low;
  return (
    <article
      className="rounded-2xl border p-4"
      style={{ background: "var(--surface, #0d1424)", borderColor: "var(--line, #22304d)", color: "var(--text, #edf2ff)" }}
      aria-label={`Visual report ${when(report.at)}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-[14px] font-semibold" style={{ color: sev.color }}>
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: sev.color }} aria-hidden />
          {sev.label}
        </span>
        <span className="text-[13px] tabular-nums" style={{ color: "var(--dim, #6f7fa3)" }}>
          {when(report.at)}
          {report.model ? ` · ${report.model}` : ""}
        </span>
      </div>
      <p className={`mt-2 font-medium leading-6 ${compact ? "text-[16px]" : "text-[18px] leading-7"}`}>{report.observed_condition}</p>
      <p className="mt-2 text-[15px] leading-6" style={{ color: report.matches_telemetry ? "var(--muted, #9aa8c7)" : "var(--red, #fb7185)" }}>
        {report.matches_telemetry ? "Consistent with the telemetry." : "Does not match the telemetry: tell ops before acting on the plan."}
      </p>
      {report.components_visible.length ? (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Components visible">
          {report.components_visible.map((c) => (
            <li key={c} className="rounded-full px-2.5 py-1 text-[13px]" style={{ background: "var(--raised, #141d31)", color: "var(--muted, #9aa8c7)" }}>
              {c}
            </li>
          ))}
        </ul>
      ) : null}
      {report.notes && !compact ? (
        <p className="mt-3 text-[15px] leading-6" style={{ color: "var(--muted, #9aa8c7)" }}>
          {report.notes}
        </p>
      ) : null}
      {report.photos.length ? (
        <ul className="mt-3 grid grid-cols-4 gap-2" aria-label="Keyframes">
          {report.photos.map((src, i) => (
            <li key={i} className="aspect-[4/3] overflow-hidden rounded-lg" style={{ background: "var(--raised, #141d31)" }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- data URL from the device camera */}
              <img src={src} alt={`Keyframe ${i + 1}`} className="h-full w-full object-cover" />
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
