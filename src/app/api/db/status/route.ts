import { NextResponse } from "next/server";
import { dbStatus } from "@/lib/db";

/** GET /api/db/status → { configured, connected, datasets[] } for the "Tiger Data" indicator. */
export async function GET() {
  return NextResponse.json(await dbStatus());
}
