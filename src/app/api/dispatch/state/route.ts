import { NextResponse, connection } from "next/server";
import { hydrateDispatch } from "@/lib/dispatch/hydrate";
import { allAlerts } from "@/lib/dispatch/store";

/** Alerts sent and the technician's decisions, for the ops dashboard. Handles are masked. */
export async function GET() {
  await connection(); // live in-memory state: never prerender
  await hydrateDispatch();
  const mask = (h: string) => (h.length > 4 ? `…${h.slice(-4)}` : h);
  return NextResponse.json(allAlerts().map((a) => ({ ...a, handle: mask(a.handle) })));
}
