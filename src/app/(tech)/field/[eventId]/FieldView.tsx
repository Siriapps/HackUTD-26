"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { use, useEffect, useReducer, useState } from "react";
import FieldCard from "@/components/FieldCard";
import LiveSession from "@/components/LiveSession";
import { notifyOps } from "@/lib/dispatch";
import { getEvent, type EventContext } from "@/lib/events";
import { buildBriefing } from "@/lib/memory/briefing";
import { addFieldNote, feedbackCounts, fieldNotes, recordFeedback, recordResolution, similar, visualReports } from "@/lib/memory/incidents";

export function FieldSkeleton() {
  return (
    <main className="field" aria-busy="true" aria-label="Loading event">
      <div className="space-y-4 px-4 pt-16">
        <div className="skeleton h-8 w-2/3" />
        <div className="skeleton h-5 w-1/2" />
        <div className="skeleton mt-8 h-16 w-3/4" />
        <div className="skeleton h-4 w-full" />
        <div className="skeleton mt-6 h-40 w-full rounded-2xl" />
      </div>
    </main>
  );
}

/** Result for one (eventId, folder) pair; a different key means "still loading". */
type Loaded = { key: string; ctx: EventContext | null; error?: string };

export default function FieldView({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = use(params);
  const folder = useSearchParams().get("folder") ?? undefined;
  const key = `${eventId}|${folder ?? ""}`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    let alive = true;
    getEvent(eventId, folder).then(
      (ctx) => alive && setLoaded({ key, ctx, error: ctx ? undefined : `No event ${eventId}${folder ? ` in ${folder}` : ""}.` }),
      (err: Error) => alive && setLoaded({ key, ctx: null, error: err.message }),
    );
    return () => {
      alive = false;
    };
  }, [eventId, folder, key]);

  const state = loaded?.key === key ? loaded : null;
  if (!state) return <FieldSkeleton />;
  if (!state.ctx) {
    return (
      <main className="field">
        <div className="px-6 pt-24 text-center">
          <h1 className="text-[22px] font-semibold">{state.error}</h1>
          <p className="mt-3 text-[15px] leading-6 text-[var(--muted)]">Pick an alert in the console, or open one of the demo events.</p>
          <div className="mt-6 flex flex-col gap-2">
            <Link href="/" className="btn btn-primary">
              Open the console
            </Link>
            <Link href="/field/FIX-PUMP" className="btn btn-ghost">
              Demo: pump failure
            </Link>
            <Link href="/field/FIX-LEAK" className="btn btn-ghost">
              Demo: pipeline leak
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const ctx = state.ctx;
  // Memory is read on every render (cheap, local) so tool calls and the close-out form show up immediately.
  const incidents = similar(ctx.event, ctx);
  const briefing = buildBriefing(ctx, incidents);

  return (
    <main className="field" data-category={ctx.event.category}>
      <FieldCard
        ctx={ctx}
        incidents={incidents}
        notes={fieldNotes(ctx.event.id)}
        reports={visualReports(ctx.event.id)}
        counts={feedbackCounts()}
        onFeedback={(kind) => {
          recordFeedback(ctx.event.category, kind);
          addFieldNote(ctx.event.id, kind === "confirm" ? "confirmation" : "dismissal", kind === "confirm" ? "Plan confirmed on the phone" : "Marked as a false alarm");
          if (kind === "confirm") void notifyOps({ event: ctx.event, folder: ctx.folder, kind: "confirmation" });
          bump();
        }}
        onResolve={async (text) => {
          recordResolution(ctx.event.id, text);
          bump();
          await notifyOps({ event: ctx.event, folder: ctx.folder, kind: "resolution", note: text });
        }}
      >
        <LiveSession ctx={ctx} briefing={briefing} onMemoryChange={bump} />
      </FieldCard>
    </main>
  );
}
