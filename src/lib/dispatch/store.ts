// In-process dispatch state: which alerts are out, to whom, and what the technician decided.
// ponytail: memory only (survives HMR via globalThis); swap for Tiger Data when the persistence layer lands.
import type { Action } from "@/lib/data/types";
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
  log: LogEntry[];
}

const g = globalThis as unknown as { __dispatch?: Map<string, OpenAlert> };
const alerts: Map<string, OpenAlert> = (g.__dispatch ??= new Map());

export const alertKey = (folder: string, eventId: string) => `${folder}|${eventId}`;

export function upsertAlert(a: Omit<OpenAlert, "key" | "log" | "status"> & Partial<Pick<OpenAlert, "status">>): OpenAlert {
  const key = alertKey(a.folder, a.eventId);
  const prev = alerts.get(key);
  const next: OpenAlert = prev
    ? { ...prev, spaceId: a.spaceId, handle: a.handle, sentAt: a.sentAt }
    : { ...a, key, status: a.status ?? "awaiting", log: [] };
  alerts.set(key, next);
  return next;
}

export const getAlert = (key: string) => alerts.get(key);
export const allAlerts = () => [...alerts.values()].sort((a, b) => b.sentAt - a.sentAt);

/** Alerts in a conversation that still need something from the tech (not resolved). */
export const openInSpace = (spaceId: string) =>
  allAlerts().filter((a) => a.spaceId === spaceId && a.status !== "resolved");

export function update(key: string, patch: Partial<OpenAlert>, entry?: LogEntry) {
  const a = alerts.get(key);
  if (!a) return undefined;
  const next = { ...a, ...patch, log: entry ? [...a.log, entry] : a.log };
  alerts.set(key, next);
  return next;
}

export function _resetStore() {
  alerts.clear();
}
