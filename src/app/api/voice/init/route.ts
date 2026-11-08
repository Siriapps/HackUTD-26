import { NextResponse } from "next/server";
import { wireDispatch } from "@/lib/dispatch/wire";
import { toolAuthOk } from "@/lib/voice/auth";
import { briefFor } from "@/lib/voice/brief";

/**
 * ElevenLabs conversation-initiation webhook: called when a call connects (inbound or outbound).
 * Returns the caller's alerts as {{briefing}} and a first line that names the most urgent one.
 */
export async function POST(request: Request) {
  wireDispatch();
  if (!toolAuthOk(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { caller_id?: string; called_number?: string };
  const brief = await briefFor(body.caller_id);
  return NextResponse.json({
    type: "conversation_initiation_client_data",
    dynamic_variables: { briefing: brief.briefing, caller_role: brief.role, open_alerts: brief.alerts.map((a) => a.eventId).join(", ") || "none" },
    conversation_config_override: { agent: { first_message: brief.firstMessage } },
  });
}
