// Server-only Photon REST client (https://photon.codes/docs/beta/api-reference).
// Reads PHOTON_API_KEY / PHOTON_PROJECT_ID from the environment; never import from client components.

const BASE = "https://api.photon.codes/v1";

export type PhotonPlatform = "imessage" | "sms" | "email" | "telegram" | "whatsapp" | "whatsapp_business";

export interface PhotonConfig {
  apiKey: string;
  projectId: string;
  senderId?: string;
}

export class PhotonError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "PhotonError";
  }
}

/** Null when Photon is not configured, so callers can degrade to Discord. */
export function photonConfig(env: Record<string, string | undefined> = process.env): PhotonConfig | null {
  const apiKey = env.PHOTON_API_KEY?.trim();
  const projectId = env.PHOTON_PROJECT_ID?.trim();
  if (!apiKey || !projectId) return null;
  return { apiKey, projectId, senderId: env.PHOTON_SENDER_ID?.trim() || undefined };
}

type FetchLike = typeof fetch;

/** Photon idempotency keys: 1-255 printable ASCII, no spaces. */
export const safeKey = (k: string) => k.replace(/[^\x21-\x7e]/g, "_").slice(0, 255) || "_";

export class PhotonClient {
  constructor(
    private readonly cfg: PhotonConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  get projectId() {
    return this.cfg.projectId;
  }

  private async req<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.cfg.apiKey}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (idempotencyKey) headers["Idempotency-Key"] = safeKey(idempotencyKey);
    const res = await this.fetchImpl(`${BASE}/projects/${this.cfg.projectId}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) {
      throw new PhotonError(
        `Photon ${method} ${path} → ${res.status} ${String(json.code ?? json.title ?? "")}${json.detail ? `: ${String(json.detail)}` : ""}`.trim(),
        res.status,
        typeof json.code === "string" ? json.code : undefined,
      );
    }
    return (json.data ?? json) as T;
  }

  createOrGetUser(platform: PhotonPlatform, handle: string) {
    return this.req<PhotonUser>("POST", "/users", { platform, handle });
  }

  listUsers(platform?: PhotonPlatform) {
    const q = new URLSearchParams({ pageSize: "100" });
    if (platform) q.set("platform", platform);
    return this.req<{ items: PhotonUser[] }>("GET", `/users?${q}`);
  }

  createOrGetSpace(platform: PhotonPlatform, participantIds: string[]) {
    const key = `space:${platform}:${[...participantIds].sort().join(",")}`;
    return this.req<PhotonSpace>("POST", "/spaces", { platform, participantIds }, key);
  }

  /** Sends plain text. `idempotencyKey` should be stable per logical alert so retries never double-text. */
  sendText(spaceId: string, text: string, idempotencyKey: string, senderId = this.cfg.senderId) {
    if (!senderId) throw new PhotonError("No sender id: call resolveSender() first", 0);
    return this.req<PhotonMessage>(
      "POST",
      "/messages",
      { spaceId, senderId, content: { type: "text", format: "plain", text } },
      idempotencyKey,
    );
  }

  /** Typing bubble in the conversation: instant feedback while the reply is composed. Best effort. */
  async typing(spaceId: string, senderId: string, on = true) {
    await this.req("POST", "/messages", { spaceId, senderId, content: { type: "space.typing.update", typing: on } }, `typing:${spaceId}:${on}:${Date.now()}`).catch(() => undefined);
  }

  /** The project's agent (our line) on a platform: PHOTON_SENDER_ID, else the first agent user. */
  async resolveSender(platform: PhotonPlatform = "imessage"): Promise<string> {
    if (this.cfg.senderId) return this.cfg.senderId;
    const { items } = await this.listUsers(platform);
    const agent = items.find((u) => u.kind === "agent");
    if (!agent) throw new PhotonError(`No ${platform} agent line on this project`, 0, "NO_AGENT");
    this.cfg.senderId = agent.id;
    return agent.id;
  }

  /** Direct space between our line and a person's handle (E.164 phone or email). */
  async directSpace(platform: PhotonPlatform, handle: string) {
    const sender = await this.resolveSender(platform);
    const peer = await this.createOrGetUser(platform, handle);
    const space = await this.createOrGetSpace(platform, [sender, peer.id]);
    return { sender, peer, space };
  }

  /** One call: text a handle. */
  async textHandle(platform: PhotonPlatform, handle: string, text: string, idempotencyKey: string) {
    const { sender, space } = await this.directSpace(platform, handle);
    return this.sendText(space.id, text, idempotencyKey, sender);
  }

  createWebhookDestination(url: string, enabledEvents: string[], apiVersion: string, name = "avon-night-shift") {
    return this.req<{ destination: { destinationId: string }; signingSecret: string }>(
      "POST",
      "/webhooks/destinations",
      { url, apiVersion, enabledEvents, name },
      `whd:${url}`,
    );
  }
}

export interface PhotonUser {
  id: string;
  handle: string;
  kind: "agent" | "human" | string;
  platform: PhotonPlatform;
}
export interface PhotonSpace {
  id: string;
  kind: string;
  participantIds: string[];
  platform: PhotonPlatform;
}
export interface PhotonMessage {
  id: string;
  status?: string;
}

const g = globalThis as unknown as { __photonClient?: { sig: string; client: PhotonClient } };

/** Shared client per config, so the resolved sender line is cached across requests. */
export function photonClient(): PhotonClient | null {
  const cfg = photonConfig();
  if (!cfg) return null;
  const sig = `${cfg.projectId}|${cfg.apiKey}|${cfg.senderId ?? ""}`;
  if (g.__photonClient?.sig !== sig) g.__photonClient = { sig, client: new PhotonClient(cfg) };
  return g.__photonClient.client;
}
