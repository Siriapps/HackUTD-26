// Rebuild On-call threads from Tiger Data so a server restart does not blank /dispatch.
import { dbConfigured } from "@/lib/db";
import { listDispatchThreads } from "@/lib/db/incidents";
import { restoreMissing, type AlertStatus, type LogEntry, type OpenAlert } from "./store";

export interface DispatchMessageRow {
  ts: number;
  dir: "out" | "in" | string;
  text: string;
  recipient?: string | null;
  payload?: { intent?: string; by?: string; spaceId?: string } | null;
}

export interface DispatchRecord {
  id: string;
  dataset: string;
  event_id: string;
  status: string;
  dispatch: unknown;
  messages: DispatchMessageRow[];
}

const STATUSES: AlertStatus[] = ["awaiting", "approved", "rejected", "resolved", "escalated"];
const isStatus = (s: unknown): s is AlertStatus => typeof s === "string" && (STATUSES as string[]).includes(s);

function isOpenAlert(v: unknown): v is OpenAlert {
  if (!v || typeof v !== "object") return false;
  const a = v as OpenAlert;
  return typeof a.key === "string" && typeof a.eventId === "string" && typeof a.folder === "string" && Array.isArray(a.log);
}

function statusFromLog(log: LogEntry[], incidentStatus: string): AlertStatus {
  if (isStatus(incidentStatus)) return incidentStatus;
  const last = [...log].reverse().find((l) => l.intent);
  if (last?.intent === "approve" || last?.intent === "trucks" || last?.intent === "shutin" || last?.intent === "option") return "approved";
  if (last?.intent === "resolved") return "resolved";
  if (last?.intent === "help") return "escalated";
  if (last?.intent === "reject") return "rejected";
  return "awaiting";
}

/** One Tiger Data incident + its messages → an OpenAlert, or null if it was never a dispatch thread. */
export function threadFromRecord(row: DispatchRecord): OpenAlert | null {
  if (isOpenAlert(row.dispatch)) return row.dispatch;
  const raw = row.messages as DispatchMessageRow[] | string | null | undefined;
  const messages: DispatchMessageRow[] = Array.isArray(raw) ? raw : typeof raw === "string" ? (JSON.parse(raw) as DispatchMessageRow[]) : [];
  if (!messages.length) return null;
  const folder = row.dataset || row.id.split("|")[0] || "";
  const eventId = row.event_id || row.id.split("|").slice(1).join("|");
  const log: LogEntry[] = messages.map((m) => ({
    at: Number(m.ts),
    dir: m.dir === "in" ? "in" : "out",
    text: m.text,
    intent: m.payload?.intent as LogEntry["intent"],
    by: m.payload?.by,
  }));
  const ack = messages.find((m) => m.payload?.intent === "ack");
  const handle = messages.map((m) => m.recipient).find((h) => h && h !== "") ?? "unsent";
  const spaceId = messages.map((m) => m.payload?.spaceId).find(Boolean) ?? "local";
  return {
    key: `${folder}|${eventId}`,
    eventId,
    folder,
    spaceId,
    handle,
    sentAt: Number(messages[0]?.ts) || Date.now(),
    status: statusFromLog(log, row.status),
    ackAt: ack ? Number(ack.ts) : undefined,
    escalation: 0,
    watchers: [],
    log,
  };
}

/** Memory wins for keys this process already holds; Tiger Data fills the rest. */
export function applyHydration(existing: OpenAlert[], loaded: OpenAlert[]): OpenAlert[] {
  const map = new Map(existing.map((a) => [a.key, a]));
  for (const t of loaded) if (!map.has(t.key)) map.set(t.key, t);
  return [...map.values()].sort((a, b) => b.sentAt - a.sentAt);
}

const g = globalThis as unknown as { __dispatchHydrated?: boolean };

export function _resetHydration() {
  g.__dispatchHydrated = false;
}

/** Load persisted threads into the in-memory store once per process. No-op without DATABASE_URL. */
export async function hydrateDispatch(): Promise<void> {
  if (g.__dispatchHydrated) return;
  if (!dbConfigured()) {
    g.__dispatchHydrated = true;
    return;
  }
  try {
    const rows = await listDispatchThreads();
    restoreMissing(rows.map(threadFromRecord).filter((a): a is OpenAlert => !!a));
    g.__dispatchHydrated = true;
  } catch (e) {
    console.warn("[dispatch] hydrate skipped:", e instanceof Error ? e.message : e);
  }
}
