import { connection, NextResponse } from "next/server";
import { dbStatus } from "@/lib/db";

/** GET /api/db/status → { configured, connected, datasets[] } for the "Tiger Data" indicator. */
export async function GET() {
  await connection(); // evaluate per request, never at build time (cacheComponents is on)
  return NextResponse.json(await dbStatus());
}
