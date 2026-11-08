"use client";

import { HandoffCard } from "@/components/HandoffCard";
import { useOps } from "@/store";
import { fmtDateTime } from "@/components/format";

/** The morning brief, on its own page: read it, copy it, text it. */
export default function HandoffPage() {
  const analysis = useOps((s) => s.analysis);
  const dataset = useOps((s) => s.dataset);
  if (!analysis || !dataset) return null;
  return (
    <div className="p-4 md:p-6 max-w-[900px] space-y-4">
      <header>
        <h1 className="text-2xl">Shift handoff</h1>
        <p className="text-sm text-ink-2 mt-1">
          For the morning crew, as of <span className="num text-ink-1">{fmtDateTime(analysis.now)}</span>. Generated from the live analysis; the same text goes out as the morning SMS.
        </p>
      </header>
      <HandoffCard />
    </div>
  );
}
