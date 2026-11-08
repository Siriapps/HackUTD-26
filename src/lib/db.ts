// Tiger Data (TimescaleDB) access. Server-only. Everything degrades to "not connected" when
// DATABASE_URL is unset so the app keeps working from the loaded folder alone.
import { Pool, type QueryResultRow } from "pg";

let pool: Pool | null | undefined;

/**
 * Pool options for a Tiger Cloud / Postgres URL. `sslmode=require` in pg >= 8.23 means full
 * verification unless `uselibpqcompat=true` is set; Tiger Cloud's hosted certs expect libpq
 * semantics (encrypted, not CA-pinned), so we add it when missing. Local URLs stay plain.
 */
export function connectionOptions(url: string, max = 4): { connectionString: string; max: number } {
  let u = url.trim();
  if (!/localhost|127\.0\.0\.1/.test(u) && /sslmode=require/.test(u) && !/uselibpqcompat=/.test(u)) u += "&uselibpqcompat=true";
  return { connectionString: u, max };
}

/** Shared pool, or null when no DATABASE_URL is configured. */
export function getPool(): Pool | null {
  if (pool !== undefined) return pool;
  const url = process.env.DATABASE_URL;
  pool = url ? new Pool(connectionOptions(url)) : null;
  return pool;
}

export const dbConfigured = () => Boolean(process.env.DATABASE_URL);

/** Run one parameterised query; returns [] when the database is not configured. */
export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const p = getPool();
  if (!p) return [];
  const res = await p.query<T>(text, params);
  return res.rows;
}

/** Quick connectivity probe for the UI indicator. */
export async function dbStatus(): Promise<{ configured: boolean; connected: boolean; datasets: string[]; error?: string }> {
  if (!dbConfigured()) return { configured: false, connected: false, datasets: [] };
  try {
    const rows = await query<{ dataset: string }>("SELECT dataset FROM datasets ORDER BY dataset");
    return { configured: true, connected: true, datasets: rows.map((r) => r.dataset) };
  } catch (e) {
    return { configured: true, connected: false, datasets: [], error: e instanceof Error ? e.message : String(e) };
  }
}
