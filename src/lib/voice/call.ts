// Outbound call through ElevenLabs over the Photon SIP trunk: the escalation ladder rings the tech and the
// AI engineer opens with the alert. No-op (false) unless the agent and imported number are configured.
import { briefFor } from "./brief";

export const voiceCallConfigured = () => !!(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_AGENT_ID && process.env.ELEVENLABS_PHONE_NUMBER_ID);

export async function callHandle(handle: string): Promise<boolean> {
  if (!voiceCallConfigured() || !/^\+\d{8,15}$/.test(handle)) return false;
  const brief = await briefFor(handle);
  const res = await fetch("https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call", {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "content-type": "application/json" },
    body: JSON.stringify({
      agent_id: process.env.ELEVENLABS_AGENT_ID,
      agent_phone_number_id: process.env.ELEVENLABS_PHONE_NUMBER_ID,
      to_number: handle,
      conversation_initiation_client_data: {
        dynamic_variables: { briefing: brief.briefing, caller_role: brief.role, open_alerts: brief.alerts.map((a) => a.eventId).join(", ") || "none" },
        conversation_config_override: { agent: { first_message: brief.firstMessage.replace("Avon night engineering.", "This is Avon night engineering calling about an alert you haven't answered.") } },
      },
    }),
  }).catch(() => null);
  return !!res?.ok;
}
