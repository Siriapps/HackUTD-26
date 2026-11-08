import { NextResponse } from "next/server";
import { tellAlert } from "@/lib/dispatch/send";
import { update } from "@/lib/dispatch/store";
import { toolAuthOk, verifyElevenLabs } from "@/lib/voice/auth";
import { callerAlerts } from "@/lib/voice/brief";

/**
 * ElevenLabs post-call webhook (post_call_transcription): log the call summary on the caller's alerts and text
 * the tech a recap, so the thread and the morning handoff know what was said.
 */
export async function POST(request: Request) {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  const raw = await request.text();
  if (secret && !verifyElevenLabs(request.headers.get("elevenlabs-signature"), raw, secret)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  // Without a signing secret, fall back to the shared tool header (the dev tunnel is public).
  if (!secret && !toolAuthOk(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = JSON.parse(raw || "{}") as {
    type?: string;
    data?: {
      conversation_id?: string;
      metadata?: { call_duration_secs?: number; phone_call?: { external_number?: string } };
      analysis?: { transcript_summary?: string };
      conversation_initiation_client_data?: { dynamic_variables?: Record<string, unknown> };
    };
  };
  if (body.type !== "post_call_transcription" || !body.data) return NextResponse.json({ ok: true, ignored: body.type });

  const d = body.data;
  const caller = d.metadata?.phone_call?.external_number ?? (d.conversation_initiation_client_data?.dynamic_variables?.system__caller_id as string | undefined);
  const summary = d.analysis?.transcript_summary?.trim();
  if (!summary) return NextResponse.json({ ok: true, note: "no summary" });

  const { alerts, role } = callerAlerts(caller);
  const mins = d.metadata?.call_duration_secs ? ` (${Math.round(d.metadata.call_duration_secs / 60)} min)` : "";
  for (const a of role === "unknown" ? [] : alerts) {
    update(a.key, {}, { at: Date.now(), dir: "in", text: `📞 Call${mins}: ${summary}`, by: "phone call" });
    await tellAlert(a, `📞 Call recap${mins}: ${summary}`, `recap:${d.conversation_id ?? Date.now()}:${a.key}`);
  }
  return NextResponse.json({ ok: true, logged: role === "unknown" ? 0 : alerts.length });
}
