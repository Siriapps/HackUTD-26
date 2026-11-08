"use client";

import { useState } from "react";
import { useOps } from "@/store";
import { FolderPicker } from "./FolderPicker";
import { ReplayControls } from "./ReplayControls";
import { DropZone } from "./DropZone";
import { fmtTime } from "./format";
import { downloadEventsJson } from "@/lib/export/eventsJson";
import { handoffText } from "@/lib/export/handoff";
import { dispatch } from "@/lib/export/notify";



export function TopBar() {
  const analysis = useOps((s) => s.analysis);
  const dataset = useOps((s) => s.dataset);
  const source = useOps((s) => s.source);
  const phase = useOps((s) => s.phase);
  const [note, setNote] = useState<string | null>(null);

  async function sendAll() {
    if (!analysis || !dataset) return;
    setNote("Sending…");
    const res = await dispatch({ type: "handoff", folder: dataset.folder, now: analysis.now, text: handoffText(analysis, dataset), links: { dashboard: "/" } });
    setNote(res.message);
    setTimeout(() => setNote(null), 4000);
  }

  return (
    <header className="shrink-0 min-h-[52px] px-3 py-1.5 flex items-center gap-3 flex-wrap border-b border-line-1 bg-surface-1">
      <div className="flex items-center gap-2 min-w-0">
        <FolderPicker />
        <DropZone />
      </div>

      <div className="ml-auto flex items-center gap-3 min-w-0 flex-wrap max-[760px]:ml-0 max-[760px]:w-full">
        {phase === "ready" && dataset && analysis && (
          <>
            <span className="hidden min-[1400px]:inline num text-xs text-ink-3 whitespace-nowrap">data to {fmtTime(dataset.now)}</span>
            <div className="max-[760px]:!hidden contents">
              <ReplayControls />
            </div>
            {source === "fixture" && (
              <span className="chip" style={{ background: "var(--accent-wash)", color: "var(--accent)" }} title="analyse() returned no events; showing the hand-written fixture from src/store/fixture.ts">
                fixture data
              </span>
            )}
            <button type="button" className="btn max-[760px]:!hidden" onClick={() => downloadEventsJson(analysis)} title="Download events.json (SPEC shape)">
              Export
            </button>
            <button type="button" className="btn btn-primary" onClick={sendAll} title="Text the shift handoff to the morning crew">
              Text handoff
            </button>
            {note && <span className="text-xs text-ink-3 whitespace-nowrap">{note}</span>}
          </>
        )}
      </div>
    </header>
  );
}
