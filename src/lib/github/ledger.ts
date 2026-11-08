// Local record of action items already filed as GitHub issues.
// The database is optional in this app, so duplicate prevention cannot depend on it.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type IssueSeverity = "critical" | "normal";

export interface LedgerIssue {
  folder: string;
  eventId: string;
  actionItemId: string;
  repo: string;
  number: number;
  url: string;
  severity: IssueSeverity;
  createdAt: string;
}

export function ledgerKey(folder: string, eventId: string, actionItemId: string): string {
  return `${folder}|${eventId}|${actionItemId}`;
}

export function ledgerPath(): string {
  return process.env.GITHUB_ISSUE_LEDGER || path.join(process.cwd(), "data", "github-issues.json");
}

function isEntry(row: unknown): row is LedgerIssue {
  if (!row || typeof row !== "object") return false;
  const r = row as Partial<LedgerIssue>;
  return typeof r.folder === "string" && typeof r.eventId === "string" && typeof r.actionItemId === "string" && typeof r.repo === "string" && typeof r.number === "number" && typeof r.url === "string" && (r.severity === "critical" || r.severity === "normal");
}

export async function readLedger(): Promise<LedgerIssue[]> {
  try {
    const raw = JSON.parse(await readFile(ledgerPath(), "utf8")) as unknown;
    return Array.isArray(raw) ? raw.filter(isEntry) : [];
  } catch {
    return [];
  }
}

export async function writeLedger(rows: LedgerIssue[]): Promise<void> {
  const file = ledgerPath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(rows, null, 2) + "\n");
}

const g = globalThis as unknown as { __ghIssueLocks?: Map<string, Promise<void>> };

/** Serialize creates for one action item so two confirms cannot both pass the ledger check. */
export function withIssueLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const locks = (g.__ghIssueLocks ??= new Map());
  const prev = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = prev.catch(() => undefined).then(() => gate);
  locks.set(key, tail);
  return prev
    .catch(() => undefined)
    .then(fn)
    .finally(() => {
      release();
      if (locks.get(key) === tail) locks.delete(key);
    });
}
