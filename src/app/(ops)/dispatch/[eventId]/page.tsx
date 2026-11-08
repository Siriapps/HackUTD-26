import { Suspense } from "react";
import { IncidentResponseView } from "./IncidentResponseView";

/** Live Incident Response page. URL: /dispatch/[eventId]?folder= */
export default function IncidentResponsePage({ params }: { params: Promise<{ eventId: string }> }) {
  return (
    <Suspense fallback={<div className="p-6 text-ink-3 text-sm">Loading…</div>}>
      <IncidentPageInner params={params} />
    </Suspense>
  );
}

async function IncidentPageInner({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return <IncidentResponseView eventId={eventId} />;
}
