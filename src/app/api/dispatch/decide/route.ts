import { NextResponse } from "next/server";
import { decide } from "@/lib/dispatch/engine";
import { tellAlert } from "@/lib/dispatch/send";
import { serverEvent } from "@/lib/dispatch/server-data";
import { getAlert } from "@/lib/dispatch/store";
import { escalateNow, wireDispatch } from "@/lib/dispatch/wire";

/**
 * Ops console decision: POST { key, command: "approve" | "no" | "trucks" | "shut in" | "opt 2" | "fixed" | "help", by? }.
 * Same engine as an iMessage reply; the tech's thread is told who decided what.
 */
export async function POST(request: Request) {
  wireDispatch();
  const body = (await request.json().catch(() => ({}))) as { key?: string; command?: string; by?: string };
  if (!body.key || !body.command) return NextResponse.json({ ok: false, message: "key and command required" }, { status: 400 });
  const by = body.by?.slice(0, 40) || "ops";
  const r = await decide(body.key, body.command, by, { getEvent: serverEvent }).catch((err) => {
    console.error("[dispatch/decide]", err instanceof Error ? err.message : err);
    return { ok: false as const, text: "Could not apply that decision right now. Check the server log." };
  });
  if (!r.ok) return NextResponse.json({ ok: false, message: r.text }, { status: 409 });
  const a = getAlert(body.key)!;
  const n = r.changed ? await tellAlert(a, `🖥 ${by === "ops" ? "Ops console" : by} on ${a.eventId}: ${r.text.split("\n")[0]}`, `ops:${a.key}:${Date.now()}`) : 0;
  if (a.status === "escalated") await escalateNow();
  return NextResponse.json({ ok: true, message: r.text, texted: n, alert: a });
}
