import { NextResponse } from "next/server";
import { sendHandoff } from "@/lib/dispatch/handoff";

/** POST { folder?, asOf?, text?, dryRun? } → text the morning crew the handoff + overnight dispatch log. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { folder?: string; asOf?: number; text?: string; dryRun?: boolean };
  const r = await sendHandoff({ consoleText: body.text, folder: body.folder, asOf: body.asOf, dryRun: body.dryRun });
  return NextResponse.json(r, { status: r.ok ? 200 : 404 });
}
