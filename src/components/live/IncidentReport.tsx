"use client";

import { useState } from "react";
import type { ReportPayload } from "@/lib/live/types";

const STATUS_LABEL: Record<ReportPayload["status"], string> = {
  draft: "Draft",
  ready_for_review: "Ready for review",
  submitted: "Submitted",
};

const STATUS_COLOR: Record<ReportPayload["status"], string> = {
  draft: "var(--warn)",
  ready_for_review: "var(--cat-leak)",
  submitted: "var(--ok)",
};

interface Props {
  report: ReportPayload | null;
  folder?: string;
  eventId?: string;
  onAction: (action: "ready" | "submit") => Promise<void>;
}

export function IncidentReport({ report, folder, eventId, onAction }: Props) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!report) {
    return (
      <section className="panel">
        <header className="panel-head">
          <h2 className="panel-title">Incident Report</h2>
        </header>
        <p className="px-4 py-4 text-sm text-ink-3">
          Ask Gemini to &ldquo;finalize the incident report&rdquo; to generate a draft.
        </p>
      </section>
    );
  }

  async function act(action: "ready" | "submit") {
    setBusy(true);
    setMsg(null);
    try {
      await onAction(action);
    } catch {
      setMsg("Action failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const st = report.status;
  const color = STATUS_COLOR[st];

  return (
    <section className="panel">
      <header className="panel-head">
        <h2 className="panel-title">Incident Report</h2>
        <span className="chip text-xs" style={{ color, background: color + "29" }}>
          {STATUS_LABEL[st]}
        </span>
      </header>

      <div className="px-4 pb-4 flex flex-col gap-3">
        <div>
          <p className="text-xs text-ink-3 mb-1">Summary</p>
          <p className="text-sm text-ink-1 leading-relaxed">{report.summary}</p>
        </div>

        {report.observations.length > 0 && (
          <div>
            <p className="text-xs text-ink-3 mb-1">Observations</p>
            <ul className="text-sm text-ink-2 list-disc list-inside space-y-0.5">
              {report.observations.map((o, i) => <li key={i}>{o}</li>)}
            </ul>
          </div>
        )}

        {report.actions.length > 0 && (
          <div>
            <p className="text-xs text-ink-3 mb-1">Actions taken</p>
            <ul className="text-sm text-ink-2 list-disc list-inside space-y-0.5">
              {report.actions.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          </div>
        )}

        {report.unresolved.length > 0 && (
          <div>
            <p className="text-xs text-ink-3 mb-1">Unresolved</p>
            <ul className="text-sm text-ink-2 list-disc list-inside space-y-0.5">
              {report.unresolved.map((u, i) => <li key={i}>{u}</li>)}
            </ul>
          </div>
        )}

        {msg && <p className="text-xs text-shutdown">{msg}</p>}

        {st !== "submitted" && (
          <div className="flex gap-2 mt-1">
            {st === "draft" && (
              <button
                type="button"
                className="btn btn-primary text-sm py-1.5"
                onClick={() => act("ready")}
                disabled={busy}
              >
                Mark ready for review
              </button>
            )}
            {(st === "ready_for_review") && (
              <button
                type="button"
                className="btn btn-primary text-sm py-1.5"
                onClick={() => act("submit")}
                disabled={busy}
              >
                {busy ? "Submitting…" : "Submit report"}
              </button>
            )}
          </div>
        )}

        {st === "submitted" && (
          <p className="text-xs text-ok">
            Report submitted. The technician confirmed and the record is closed.
          </p>
        )}
      </div>
    </section>
  );
}
