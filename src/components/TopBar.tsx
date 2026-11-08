"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useOps } from "@/store";
import { FolderPicker } from "./FolderPicker";
import { TimeScrubber } from "./TimeScrubber";
import { fmtTime } from "./format";
import { downloadEventsJson } from "@/lib/export/eventsJson";
import { handoffText } from "@/lib/export/handoff";
import { dispatch } from "@/lib/export/notify";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/timeline", label: "Timeline" },
  { href: "/dispatch", label: "On-call" },
];

export function TopBar() {
  const pathname = usePathname();
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
      <Link href="/" className="brand text-xl tracking-tight text-ink-1 no-underline whitespace-nowrap">
        Flare
      </Link>
      <nav className="flex items-center gap-0.5 ml-1">
        {NAV.map((n) => {
          const active = n.href === "/" ? pathname === "/" || pathname.startsWith("/facility") : pathname.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`px-2.5 h-7 inline-flex items-center rounded-md text-sm no-underline ${active ? "bg-surface-3 text-ink-1" : "text-ink-2 hover:text-ink-1 hover:bg-surface-2"}`}
              aria-current={active ? "page" : undefined}
            >
              {n.label}
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-3 min-w-0 flex-wrap max-[760px]:ml-0 max-[760px]:w-full">
        <FolderPicker />
        {phase === "ready" && dataset && analysis && (
          <>
            <span className="hidden min-[1200px]:inline num text-xs text-ink-3 whitespace-nowrap">data to {fmtTime(dataset.now)}</span>
            <div className="max-[760px]:hidden contents">
              <TimeScrubber />
            </div>
            {source === "fixture" && (
              <span className="chip" style={{ background: "var(--accent-wash)", color: "var(--accent)" }} title="analyse() returned no events; showing the hand-written fixture from src/store/fixture.ts">
                fixture data
              </span>
            )}
            <button type="button" className="btn max-[760px]:hidden" onClick={() => downloadEventsJson(analysis)} title="Download events.json (SPEC shape)">
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
