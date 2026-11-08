// In-process dispatch state: which alerts are out, to whom, and what the technician decided.
// Survives HMR via globalThis; Tiger Data is the restart-proof copy (hydrateDispatch on /api/dispatch/state).
import type { Action } from "@/lib/data/types";
import { annotateIncident, logMessage, saveDispatch } from "../db/incidents";
import type { Intent } from "./replies";

export type AlertStatus = "awaiting" | "approved" | "rejected" | "resolved" | "escalated";

export interface Choice {
  label: string;
  cost: number;
  actions: Action[];
}

export interface LogEntry {
  at: number;
  dir: "out" | "in";
  text: string;
  intent?: Intent;
  /** Who: "tech", "supervisor", "ops", "field app". */
  by?: string;
}

/** What the field said happened, for the morning crew and incident memory. */
export interface Resolution {
  at: number;
  by: string;
  notes: string[];
  /** Photon attachment ids. */
  photos: string[];
}

export interface OpenAlert {
  key: string;
  eventId: string;
  folder: string;
  spaceId: string;
  handle: string;
  sentAt: number;
  status: AlertStatus;
  choice?: Choice;
  decidedAt?: number;
  /** Who made the current decision. */
  decidedBy?: string;
  /** Dataset time the alert was computed at (operator time travel); undefined = end of data. */
  asOf?: number;
  /** Someone acknowledged (OMW / arrived / copy) without deciding. */
  ackAt?: number;
  resolution?: Resolution;
  /** After FIXED, the next free text or photo in this thread is saved as a note until this time. */
  noteUntil?: number;
  /** 0 = tech only; each escalation step adds one (reminder, supervisor, all hands). */
  escalation: number;
  /** People pulled in by escalation; their replies act on this alert too. */
  watchers: Watcher[];
  log: LogEntry[];
}

export interface Watcher {
  spaceId: string;
  handle: string;
  role: string;
  name?: string;
}

const g = globalThis as unknown as { __dispatch?: Map<string, OpenAlert> };
const alerts: Map<string, OpenAlert> = (g.__dispatch ??= new Map());

export const alertKey = (folder: string, eventId: string) => `${folder}|${eventId}`;

export function upsertAlert(
  a: Omit<OpenAlert, "key" | "log" | "status" | "escalation" | "watchers"> & Partial<Pick<OpenAlert, "status">>,
): OpenAlert {
  const key = alertKey(a.folder, a.eventId);
  const prev = alerts.get(key);
  const next: OpenAlert = prev
    ? { ...prev, spaceId: a.spaceId, handle: a.handle, asOf: a.asOf ?? prev.asOf } // keep sentAt: a re-send must not reset escalation
    : { ...a, key, status: a.status ?? "awaiting", escalation: 0, watchers: [], log: [] };
  alerts.set(key, next);
  saveDispatch(next);
  return next;
}

export const getAlert = (key: string) => alerts.get(key);
export const allAlerts = () => [...alerts.values()].sort((a, b) => b.sentAt - a.sentAt);

/** Fill keys this process does not already have (used after a restart to reload Tiger Data). */
export function restoreMissing(threads: OpenAlert[]) {
  for (const t of threads) if (!alerts.has(t.key)) alerts.set(t.key, t);
}

export const inSpace = (a: OpenAlert, spaceId: string) => a.spaceId === spaceId || (a.watchers ?? []).some((w) => w.spaceId === spaceId);

/** Alerts in a conversation (tech's or an escalation watcher's) that are not resolved. */
export const openInSpace = (spaceId: string) => allAlerts().filter((a) => inSpace(a, spaceId) && a.status !== "resolved");

/** Every conversation following an alert except `spaceId`. */
export const otherSpaces = (a: OpenAlert, spaceId: string) =>
  [a.spaceId, ...(a.watchers ?? []).map((w) => w.spaceId)].filter((s, i, all) => s !== spaceId && all.indexOf(s) === i);

export function update(key: string, patch: Partial<OpenAlert>, entry?: LogEntry) {
  const a = alerts.get(key);
  if (!a) return undefined;
  const next = { ...a, ...patch, log: entry ? [...a.log, entry] : a.log };
  alerts.set(key, next);
  saveDispatch(next);
  if (entry) {
    logMessage({
      folder: a.folder,
      eventId: a.eventId,
      channel: "photon",
      direction: entry.dir,
      recipient: a.handle,
      body: entry.text,
      payload: { intent: entry.intent, by: entry.by, spaceId: next.spaceId },
    });
  }
  if (patch.status) annotateIncident(a.folder, a.eventId, { status: patch.status });
  return next;
}

export function _resetStore() {
  alerts.clear();
  const g2 = globalThis as unknown as { __dispatchHydrated?: boolean };
  g2.__dispatchHydrated = false;
}
