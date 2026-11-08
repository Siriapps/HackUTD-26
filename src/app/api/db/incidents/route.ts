import { connection, NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";
import { listIncidents } from "@/lib/db/incidents";

/** GET /api/db/incidents → what Tiger Data remembers (incidents + message counts). */
export async function GET() {
  await connection();
  if (!dbConfigured()) return NextResponse.json({ connected: false, incidents: [] }, { status: 503 });
  try {
    return NextResponse.json({ connected: true, incidents: await listIncidents() });
  } catch (e) {
    return NextResponse.json({ connected: false, error: e instanceof Error ? e.message : String(e), incidents: [] }, { status: 502 });
  }
}
