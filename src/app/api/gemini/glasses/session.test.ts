import { GoogleGenAI } from "@google/genai";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { FIELD_TOOLS, buildBriefing } from "@/lib/memory";
import { FIXTURES } from "@/lib/memory/fixture";
import { liveConfig } from "../gemini";
import { GLASSES_VISION_RULES, deviceAllowed, liveSetupMessage, liveWebSocketUrl } from "./session";
import { LIVE_TOOLS } from "@/lib/live/live-tools";
import { SIMULATION_RULES } from "@/lib/live/simulation";

interface WsServer {
  on(ev: "connection", cb: (sock: { on(ev: "message", cb: (d: Buffer) => void): void; send(d: string): void }, req: { url?: string }) => void): void;
  address(): AddressInfo;
  close(): void;
}
const { WebSocketServer } = createRequire(import.meta.url)("ws") as { WebSocketServer: new (o: { port: number }) => WsServer };

/** What `@google/genai` actually puts on the wire for `ai.live.connect`, captured by a local WebSocket server. */
async function sdkSetupFrame(model: string, config: ReturnType<typeof liveConfig>, apiKey: string) {
  const server = new WebSocketServer({ port: 0 });
  const frame = new Promise<{ url: string; message: Record<string, unknown> }>((resolve) => {
    server.on("connection", (sock, req) => {
      sock.on("message", (d) => {
        resolve({ url: req.url ?? "", message: JSON.parse(d.toString()) });
        sock.send(JSON.stringify({ setupComplete: {} }));
      });
    });
  });
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha", baseUrl: `http://127.0.0.1:${server.address().port}` } });
  const session = await ai.live.connect({ model, config, callbacks: { onmessage: () => undefined } });
  const out = await frame;
  session.close();
  server.close();
  return out;
}

describe("glasses live session", () => {
  const ctx = FIXTURES["FIX-LEAK"];
  const config = liveConfig(`${buildBriefing(ctx)}\n\n${GLASSES_VISION_RULES}`, FIELD_TOOLS);

  it("sends the same setup frame as @google/genai", async () => {
    const { url, message } = await sdkSetupFrame("gemini-test-live", config, "auth_tokens/abc");
    expect(url).toContain("GenerativeService.BidiGenerateContentConstrained?access_token=auth_tokens/abc");
    expect({ setup: liveSetupMessage("gemini-test-live", config) }).toEqual(message);
  });

  it("points native clients at the constrained endpoint for ephemeral tokens", () => {
    expect(liveWebSocketUrl("v1alpha")).toBe(
      "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained",
    );
  });

  it("keeps the facility briefing and adds the observed-vs-interpreted rules", () => {
    const text = (liveSetupMessage("m", config).systemInstruction as { parts: { text: string }[] }).parts[0].text;
    expect(text).toContain(ctx.event.asset);
    expect(text).toContain("Never say corrosion, a leak, a crack or a safety hazard is confirmed from the picture alone");
  });

  it("requires the device token when one is configured, and is dev-only without it", () => {
    const req = (h: Record<string, string> = {}) => new Request("http://x/api/gemini/glasses", { headers: h });
    expect(deviceAllowed(req(), { NODE_ENV: "development" })).toBe(true);
    expect(deviceAllowed(req(), { NODE_ENV: "production" })).toBe(false);
    expect(deviceAllowed(req(), { FIELD_DEVICE_TOKEN: "s3cret", NODE_ENV: "development" })).toBe(false);
    expect(deviceAllowed(req({ "x-field-token": "s3cret" }), { FIELD_DEVICE_TOKEN: "s3cret", NODE_ENV: "production" })).toBe(true);
  });
});

describe("LIVE_TOOLS: glasses-only incident response tools", () => {
  it("includes update_runbook_step", () => {
    expect(LIVE_TOOLS.map((t) => t.name)).toContain("update_runbook_step");
  });

  it("includes draft_incident_report", () => {
    expect(LIVE_TOOLS.map((t) => t.name)).toContain("draft_incident_report");
  });

  it("includes submit_incident_report", () => {
    expect(LIVE_TOOLS.map((t) => t.name)).toContain("submit_incident_report");
  });

  it("does NOT include LIVE_TOOLS names in FIELD_TOOLS (phone /field unaffected)", () => {
    const liveNames = new Set(LIVE_TOOLS.map((t) => t.name));
    const fieldNames = FIELD_TOOLS.map((t) => t.name);
    for (const name of fieldNames) {
      expect(liveNames.has(name)).toBe(false);
    }
  });

  it("liveConfig with FIELD_TOOLS + LIVE_TOOLS includes update_runbook_step in tools", () => {
    const ctx = FIXTURES["FIX-LEAK"];
    const briefing = `${buildBriefing(ctx)}\n\n${GLASSES_VISION_RULES}`;
    const config = liveConfig(briefing, [...FIELD_TOOLS, ...LIVE_TOOLS]);
    const setup = liveSetupMessage("gemini-test", config) as { tools?: { functionDeclarations?: { name: string }[] }[] };
    const names = setup.tools?.flatMap((t) => t.functionDeclarations?.map((f) => f.name) ?? []) ?? [];
    expect(names).toContain("update_runbook_step");
  });
});

describe("SIMULATION_RULES isolation", () => {
  it("phone briefing (no simulation) does not contain SIMULATION MODE", () => {
    const ctx = FIXTURES["FIX-LEAK"];
    const briefing = buildBriefing(ctx);
    expect(briefing).not.toContain("SIMULATION MODE");
  });

  it("glasses briefing with simulation === true contains SIMULATION MODE", () => {
    const ctx = FIXTURES["FIX-LEAK"];
    const briefing = `${buildBriefing(ctx)}\n\n${GLASSES_VISION_RULES}\n\n${SIMULATION_RULES}`;
    expect(briefing).toContain("SIMULATION MODE");
  });

  it("glasses briefing without simulation flag does not contain SIMULATION MODE", () => {
    const ctx = FIXTURES["FIX-LEAK"];
    const briefing = `${buildBriefing(ctx)}\n\n${GLASSES_VISION_RULES}`;
    expect(briefing).not.toContain("SIMULATION MODE");
  });
});
