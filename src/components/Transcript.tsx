"use client";

import { useEffect, useRef } from "react";

export interface Line {
  id: number;
  role: "tech" | "gemini" | "system";
  text: string;
  /** Still being appended to (partial transcription). */
  open?: boolean;
}

const ROLE_LABEL = { tech: "You", gemini: "Gemini", system: "" } as const;

export default function Transcript({ lines, speaking }: { lines: Line[]; speaking?: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [lines]);

  if (!lines.length) {
    return <p className="px-1 py-3 text-[15px] leading-6 text-[var(--dim)]">The transcript appears here once the call starts. Say what you see; it hears you and watches the camera.</p>;
  }
  return (
    <ol className="flex max-h-[50dvh] flex-col gap-3 overflow-y-auto px-1 py-2" aria-live="polite" aria-label="Call transcript">
      {lines.map((l) =>
        l.role === "system" ? (
          <li key={l.id} className="text-[14px] leading-5 text-[var(--dim)]">
            {l.text}
          </li>
        ) : (
          <li key={l.id} className="grid grid-cols-[3.5rem_1fr] gap-x-3">
            <span className={`pt-[3px] text-[13px] font-semibold ${l.role === "gemini" ? "text-[var(--cat)]" : "text-[var(--muted)]"}`}>{ROLE_LABEL[l.role]}</span>
            <p className="text-[17px] leading-6 text-[var(--text)]">
              {l.text}
              {l.open && l.role === "gemini" && speaking ? <span className="ml-1 inline-block h-4 w-[3px] translate-y-[2px] animate-pulse bg-[var(--cat)]" aria-hidden /> : null}
            </p>
          </li>
        ),
      )}
      <div ref={end} />
    </ol>
  );
}
