#!/usr/bin/env node
// Creates (or updates) the ElevenLabs phone agent for the Avon night engineer and wires it to this app.
// Safe to re-run: after a new tunnel URL, run it again and every tool + webhook URL is updated in place.
//
//   npm run voice:agent
//
// Needs in .env.local: ELEVENLABS_API_KEY, PUBLIC_BASE_URL (https).
// Optional: PHOTON_VOICE_NUMBER + PHOTON_SIP_ADDRESS + PHOTON_SIP_USERNAME + PHOTON_SIP_PASSWORD to import the
// Photon number as a SIP trunk and attach the agent (see docs in the PR).
// Writes back: VOICE_TOOL_SECRET (generated once), ELEVENLABS_AGENT_ID, ELEVENLABS_PHONE_NUMBER_ID.
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { AGENT_NAME, SYSTEM_PROMPT, TOOL_DEFS } from "../src/lib/voice/prompt.ts";

const ENV_FILE = ".env.local";
const env = { ...process.env };
let envText = "";
try {
  envText = readFileSync(ENV_FILE, "utf8");
  for (const line of envText.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !env[m[1]]) env[m[1]] = m[2];
  }
} catch {}

function saveEnv(key, value) {
  env[key] = value;
  const re = new RegExp(`^${key}=.*$`, "m");
  envText = re.test(envText) ? envText.replace(re, `${key}=${value}`) : `${envText.replace(/\n?$/, "\n")}${key}=${value}\n`;
  writeFileSync(ENV_FILE, envText);
}

const die = (msg) => {
  console.error(msg);
  process.exit(1);
};

const KEY = env.ELEVENLABS_API_KEY;
const BASE = (env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
if (!KEY) die("ELEVENLABS_API_KEY missing in .env.local (elevenlabs.io → Developers → API keys).");
if (!BASE.startsWith("https://")) die("PUBLIC_BASE_URL must be the public https tunnel/deploy URL.");
if (!env.VOICE_TOOL_SECRET) saveEnv("VOICE_TOOL_SECRET", randomBytes(24).toString("hex"));
const SECRET = env.VOICE_TOOL_SECRET;

async function el(method, path, body) {
  const res = await fetch(`https://api.elevenlabs.io${path}`, {
    method,
    headers: { "xi-api-key": KEY, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) die(`ElevenLabs ${method} ${path} → ${res.status}: ${text.slice(0, 800)}`);
  return json;
}

// 1. Tools: one webhook per action; the caller's number is filled by ElevenLabs, never by the LLM.
const toolName = (n) => `avon_${n}`;
const existing = (await el("GET", "/v1/convai/tools")).tools ?? [];
const toolIds = [];
for (const t of TOOL_DEFS) {
  const properties = {
    caller: { type: "string", dynamic_variable: "system__caller_id" },
    ...Object.fromEntries(Object.entries(t.params).map(([k, d]) => [k, { type: "string", description: d }])),
  };
  const tool_config = {
    type: "webhook",
    name: toolName(t.name),
    description: t.description,
    api_schema: {
      url: `${BASE}/api/voice/tool/${t.name}`,
      method: "POST",
      request_headers: { "x-avon-voice": SECRET },
      request_body_schema: { type: "object", description: t.description, properties, required: ["caller", ...t.required] },
    },
  };
  const found = existing.find((x) => x.tool_config?.name === tool_config.name);
  const r = found ? await el("PATCH", `/v1/convai/tools/${found.id}`, { tool_config }) : await el("POST", "/v1/convai/tools", { tool_config });
  toolIds.push(r.id ?? found.id);
  console.log(`${found ? "updated" : "created"} tool ${tool_config.name}`);
}

// 2. Agent: standing prompt + {{briefing}} from /api/voice/init at call start.
const agentBody = {
  name: AGENT_NAME,
  conversation_config: {
    agent: {
      first_message: "Avon night engineering. What's going on?",
      language: "en",
      prompt: { prompt: SYSTEM_PROMPT, tool_ids: toolIds },
      dynamic_variables: { dynamic_variable_placeholders: { briefing: "(no briefing loaded)", caller_role: "unknown", open_alerts: "none" } },
    },
  },
  platform_settings: {
    overrides: { conversation_config_override: { agent: { first_message: true } } },
    workspace_overrides: {
      conversation_initiation_client_data_webhook: { url: `${BASE}/api/voice/init`, request_headers: { "x-avon-voice": SECRET } },
    },
  },
};
let agentId = env.ELEVENLABS_AGENT_ID;
if (agentId) {
  await el("PATCH", `/v1/convai/agents/${agentId}`, agentBody);
  console.log(`updated agent ${agentId}`);
} else {
  agentId = (await el("POST", "/v1/convai/agents/create", agentBody)).agent_id;
  saveEnv("ELEVENLABS_AGENT_ID", agentId);
  console.log(`created agent ${agentId}`);
}

// 3. Optional: import the Photon number as a SIP trunk and attach the agent.
const { PHOTON_VOICE_NUMBER: num, PHOTON_SIP_ADDRESS: addr, PHOTON_SIP_USERNAME: user, PHOTON_SIP_PASSWORD: pass } = env;
if (env.ELEVENLABS_PHONE_NUMBER_ID) {
  await el("PATCH", `/v1/convai/phone-numbers/${env.ELEVENLABS_PHONE_NUMBER_ID}`, { agent_id: agentId });
  console.log(`phone number ${env.ELEVENLABS_PHONE_NUMBER_ID} → agent`);
} else if (num && addr && user && pass) {
  const r = await el("POST", "/v1/convai/phone-numbers", {
    provider: "sip_trunk",
    phone_number: num,
    label: "Avon night line (Photon)",
    agent_id: agentId,
    inbound_trunk_config: { media_encryption: "allowed", allowed_addresses: ["0.0.0.0/0"] },
    outbound_trunk_config: {
      address: addr.replace(/^sips?:/, ""),
      transport: "tls",
      media_encryption: "allowed",
      enabled_codecs: ["G722/8000", "PCMU/8000", "PCMA/8000"],
      credentials: { username: user, password: pass },
    },
  });
  saveEnv("ELEVENLABS_PHONE_NUMBER_ID", r.phone_number_id);
  console.log(`imported ${num} as ${r.phone_number_id}`);
} else {
  console.log("Phone number not imported yet: set PHOTON_VOICE_NUMBER, PHOTON_SIP_ADDRESS, PHOTON_SIP_USERNAME, PHOTON_SIP_PASSWORD and re-run.");
}

console.log(`\nDone. Test in the browser: https://elevenlabs.io/app/agents/agents/${agentId}`);
