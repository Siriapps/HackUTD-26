// Narrow Photon webhook events (apiVersion 2026-07-01) to the fields dispatch needs.

export const WEBHOOK_API_VERSION = "2026-07-01";
export const SUBSCRIBED_EVENTS = [
  "message.received",
  "message.delivered",
  "message.failed",
  "call.answered",
  "call.dtmf.received",
  "call.ended",
] as const;

export interface InboundText {
  kind: "inbound_text";
  eventId: string;
  messageId: string;
  spaceId: string;
  platform: string;
  senderId: string;
  senderHandle: string;
  text: string;
  at: string;
}
export interface DeliveryUpdate {
  kind: "delivery";
  eventId: string;
  messageId: string;
  spaceId: string | null;
  status: "delivered" | "failed";
  at: string;
}
export interface OtherEvent {
  kind: "other";
  eventId: string;
  type: string;
}
export type PhotonEvent = InboundText | DeliveryUpdate | OtherEvent;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Text of a message content, flattening iMessage "group" parts. */
function contentText(c: Obj): string {
  if (c.type === "text") return str(c.text);
  if (c.type === "group" && Array.isArray(c.parts)) {
    return c.parts
      .map((p) => contentText(obj(p)))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export function parseEvent(body: unknown): PhotonEvent {
  const e = obj(body);
  const type = str(e.type);
  const eventId = str(e.id);
  const m = obj(obj(e.data).object);
  const at = str(e.timestamp) || str(m.createdAt);
  const spaceId = str(obj(m.space).id);

  if (type === "message.received") {
    const text = contentText(obj(m.content)).trim();
    const sender = obj(m.sentBy);
    if (text && spaceId) {
      return {
        kind: "inbound_text",
        eventId,
        messageId: str(m.id),
        spaceId,
        platform: str(m.platform),
        senderId: str(sender.id),
        senderHandle: str(sender.handle),
        text,
        at,
      };
    }
  }
  if (type === "message.delivered" || type === "message.failed") {
    return {
      kind: "delivery",
      eventId,
      messageId: str(m.id),
      spaceId: spaceId || null,
      status: type === "message.delivered" ? "delivered" : "failed",
      at,
    };
  }
  return { kind: "other", eventId, type };
}
