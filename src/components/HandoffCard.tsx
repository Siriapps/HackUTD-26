"use client";

import { useMemo, useState } from "react";
import { useOps } from "@/store";
import { handoffText } from "@/lib/export/handoff";
import { dispatch } from "@/lib/export/notify";

/** The 30-second shift handoff: deterministic text from the Analysis, copy + text to the morning crew. */
export function HandoffCard() {
  const analysis = useOps((s) => s.analysis);
  const dataset = useOps((s) => s.dataset);
  const [status, setStatus] = useState<string | null>(null);
  const text = useMemo(() => (analysis && dataset ? handoffText(analysis, dataset) : ""), [analysis, dataset]);
  if (!analysis || !dataset) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied");
    } catch {
      setStatus("Clipboard blocked: select the text and copy");
    }
    setTimeout(() => setStatus(null), 2500);
  }
  async function post() {
    setStatus("Sending…");
    const res = await dispatch({ type: "handoff", folder: dataset!.folder, now: analysis!.now, text, links: { dashboard: "/" } });
    setStatus(res.message);
  }

  return (
    <section className="panel flex flex-col min-h-0">
      <header className="panel-head">
        <h2 className="panel-title">Shift handoff</h2>
        <span className="panel-sub">30 s read for the morning crew</span>
      </header>
      <p className="px-4 pt-3 pb-2 text-sm leading-relaxed whitespace-pre-wrap text-ink-2 overflow-auto min-h-0 [&>*]:text-ink-1">{text}</p>
      <div className="px-4 pb-3 pt-1 flex items-center gap-2 text-xs">
        <button type="button" className="btn" onClick={copy}>
          Copy text
        </button>
        <button type="button" className="btn" onClick={post}>
          Text morning crew
        </button>
        {status && <span className="text-ink-3 truncate">{status}</span>}
      </div>
    </section>
  );
}
