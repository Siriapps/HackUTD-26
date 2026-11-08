import { NextResponse } from "next/server";
import { escalateNow, wireDispatch } from "@/lib/dispatch/wire";
import { toolAuthOk } from "@/lib/voice/auth";
import { TOOL_DEFS } from "@/lib/voice/prompt";
import { runTool, type ToolBody } from "@/lib/voice/tools";

const NAMES = new Set<string>(TOOL_DEFS.map((t) => t.name));

/** One webhook per agent tool: POST /api/voice/tool/<name> with { caller, event_id?, ... }. */
export async function POST(request: Request, ctx: { params: Promise<{ name: string }> }) {
  wireDispatch();
  if (!toolAuthOk(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { name } = await ctx.params;
  if (!NAMES.has(name)) return NextResponse.json({ error: `unknown tool ${name}` }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as ToolBody;
  try {
    return NextResponse.json(await runTool(name, body, { escalate: escalateNow }));
  } catch (err) {
    console.error("[voice] tool", name, err);
    return NextResponse.json({ result: "That didn't go through on our side. Try again, or I can page the supervisor." });
  }
}
