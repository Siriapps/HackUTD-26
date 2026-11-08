"use client";

import { useEffect, useRef } from "react";
import type { TranscriptLine } from "@/lib/live/types";

const ROLE_LABEL = { tech: "Tech", gemini: "Gemini", system: "" } as const;

function ts(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

interface Props {
  lines: TranscriptLine[];
  categoryColor?: string;
}

export function LiveTranscript({ lines, categoryColor = "var(--cat-failure)" }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const prevLen = useRef(0);

  useEffect(() => {
    if (lines.length > prevLen.current) {
      endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      prevLen.current = lines.length;
    }
  }, [lines.length]);

  if (!lines.length) {
    return (
      <p className="px-4 py-6 text-sm text-ink-3">
        Transcript appears here once the glasses session starts. On the iPhone, set the Event ID to
        this incident and tap <span className="text-ink-2">Start Live</span>.
      </p>
    );
  }

  return (
    <ol
      className="flex flex-col gap-3 overflow-y-auto px-4 py-3 h-full"
      style={{ maxHeight: "calc(100vh - 280px)", minHeight: "160px" }}
      aria-live="polite"
      aria-label="Call transcript"
    >
      {lines.map((l) =>
        l.role === "system" ? (
          <li key={l.id} className="flex gap-2 items-baseline">
            <span className="num text-xs text-ink-3 shrink-0 w-16">{ts(l.at)}</span>
            <span className="text-xs text-ink-3 italic">{l.text}</span>
          </li>
        ) : (
          <li key={l.id} className="grid grid-cols-[4.5rem_1fr] gap-x-3">
            <div className="pt-[2px] flex flex-col gap-0.5">
              <span
                className="text-xs font-semibold"
                style={{ color: l.role === "gemini" ? categoryColor : "var(--text-2)" }}
              >
                {ROLE_LABEL[l.role]}
              </span>
              <span className="num text-[11px] text-ink-3">{ts(l.at)}</span>
            </div>
            <p className="text-sm leading-relaxed text-ink-1">
              {l.text}
              {l.open && l.role === "gemini" && (
                <span
                  className="ml-1 inline-block h-3.5 w-0.5 translate-y-[1px] animate-pulse"
                  style={{ background: categoryColor }}
                  aria-hidden
                />
              )}
            </p>
          </li>
        ),
      )}
      <div ref={endRef} />
    </ol>
  );
}
