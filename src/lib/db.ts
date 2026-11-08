// Tiger Data (TimescaleDB) access. Server-only. Everything degrades to "not connected" when
// DATABASE_URL is unset so the app keeps working from the loaded folder alone.
import { Pool, type QueryResultRow } from "pg";

let pool: Pool | null | undefined;

/** Shared pool, or null when no DATABASE_URL is configured. */
export function getPool(): Pool | null {
  if (pool !== undefined) return pool;
  const url = process.env.DATABASE_URL;
  pool = url ? new Pool({ connectionString: url, max: 4, ssl: url.includes("localhost") ? undefined : { rejectUnauthorized: false } }) : null;
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
