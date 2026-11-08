"use client";

import type { RunbookState, StepStatus } from "@/lib/live/types";

const STATUS_STYLE: Record<StepStatus, { label: string; fg: string; bg: string }> = {
  pending: { label: "Pending", fg: "var(--text-3)", bg: "var(--surface-3)" },
  in_progress: { label: "In progress", fg: "var(--accent)", bg: "var(--cat-degradation-soft)" },
  completed: { label: "Completed", fg: "var(--ok)", bg: "var(--ok-soft)" },
  blocked: { label: "Blocked", fg: "var(--shutdown)", bg: "var(--shutdown-soft)" },
};

interface Props {
  runbook: RunbookState | null;
  eventId?: string;
  folder?: string;
  onConfirmStep?: (stepIndex: number) => Promise<void>;
}

export function RunbookPanel({ runbook, eventId, folder, onConfirmStep }: Props) {
  if (!runbook) {
    return (
      <div className="panel flex-1 min-h-0 flex flex-col">
        <header className="panel-head">
          <h2 className="panel-title">Runbook</h2>
        </header>
        <p className="px-4 py-4 text-sm text-ink-3">
          Runbook loads when the glasses session starts.
        </p>
      </div>
    );
  }

  const { steps, rule } = runbook;
  const done = steps.filter((s) => s.status === "completed").length;
  const total = steps.length;

  return (
    <div className="panel flex flex-col min-h-0">
      <header className="panel-head">
        <h2 className="panel-title">Runbook</h2>
        <span className="panel-sub num">
          {done}/{total} steps
        </span>
      </header>

      {/* Progress bar */}
      <div className="mx-4 mb-3 h-1.5 rounded-full bg-surface-3 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${total ? (done / total) * 100 : 0}%`,
            background: "var(--ok)",
          }}
        />
      </div>

      <ul className="divide-y divide-line-1 overflow-y-auto flex-1">
        {steps.map((step) => {
          const st = STATUS_STYLE[step.status];
          return (
            <li key={step.index} className="px-4 py-3">
              <div className="flex items-start gap-2">
                <span className="num text-xs text-ink-3 shrink-0 w-5 pt-[3px]">{step.index + 1}.</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-ink-1 leading-snug">{step.text}</span>
                    <span className="chip text-xs" style={{ color: st.fg, background: st.bg }}>
                      {st.label}
                    </span>
                  </div>
                  {step.observation && (
                    <p className="mt-1 text-xs text-ink-2 italic">{step.observation}</p>
                  )}
                  {step.at && step.status !== "pending" && (
                    <p className="mt-0.5 num text-[11px] text-ink-3">
                      {new Date(step.at).toLocaleTimeString()}
                    </p>
                  )}
                  {/* Ops confirm button — only for in_progress steps */}
                  {step.status === "in_progress" && onConfirmStep && (
                    <button
                      type="button"
                      className="btn mt-1.5 text-xs py-0.5 px-2"
                      onClick={() => onConfirmStep(step.index)}
                    >
                      Confirm complete
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {rule && (
        <footer className="px-4 py-2.5 border-t border-line-1">
          <p className="text-xs text-ink-2 italic">
            <span className="text-ink-3">Rule: </span>
            {rule}
          </p>
        </footer>
      )}
    </div>
  );
}
