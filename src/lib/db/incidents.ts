// Tiger Data writes for incidents and messages. Server-only, fire-and-forget, silent no-op
// without DATABASE_URL so the console never depends on the database to work.
import type { Event } from "../data/types";
import { dbConfigured, query } from "../db";

const id = (folder: string, eventId: string) => `${folder}|${eventId}`;
const swallow = (p: Promise<unknown>) => void p.catch((e) => console.warn("[tiger] write skipped:", e instanceof Error ? e.message : e));

/** Upsert the incident row from a console Event (plan, evidence, status). */
export function upsertIncident(folder: string, e: Event): void {
  if (!dbConfigured()) return;
  swallow(
    query(
      `INSERT INTO incidents (id, dataset, event_id, system_id, facility_id, asset_id, category, onset_ts, end_ts, status, confidence, evidence, plan, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,to_timestamp($8),CASE WHEN $9::double precision IS NULL THEN NULL ELSE to_timestamp($9) END,$10,$11,$12::jsonb,$13::jsonb,now())
       ON CONFLICT (id) DO UPDATE SET end_ts = EXCLUDED.end_ts, status = EXCLUDED.status, confidence = EXCLUDED.confidence,
         evidence = EXCLUDED.evidence, plan = COALESCE(EXCLUDED.plan, incidents.plan), updated_at = now()`,
      [id(folder, e.id), folder, e.id, e.system, e.facility, e.asset, e.category, e.onset_unix, e.end_unix, e.status, e.confidence, JSON.stringify(e.evidence), e.plan ? JSON.stringify({ recommended: e.plan.recommended, alternatives: e.plan.alternatives.map((o) => ({ label: o.label, cost: o.cost, feasible: o.feasible, actions: o.actions })) }) : null],
    ),
  );
}

/** Attach what the technician said / saw / decided. Creates a stub row if the event was never upserted. */
export function annotateIncident(folder: string, eventId: string, patch: { verdict?: string; resolution?: string; visual_report?: unknown; status?: string; end_unix?: number | null; category?: string; system?: string; facility?: string; asset?: string; onset_unix?: number }): void {
  if (!dbConfigured()) return;
  swallow(
    query(
      `INSERT INTO incidents (id, dataset, event_id, system_id, facility_id, asset_id, category, onset_ts, end_ts, status, visual_report, verdict, resolution, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,to_timestamp($8),CASE WHEN $9::double precision IS NULL THEN NULL ELSE to_timestamp($9) END,$10,$11::jsonb,$12,$13,now())
       ON CONFLICT (id) DO UPDATE SET
         end_ts = COALESCE(EXCLUDED.end_ts, incidents.end_ts), status = COALESCE($10, incidents.status),
         visual_report = COALESCE(EXCLUDED.visual_report, incidents.visual_report), verdict = COALESCE($12, incidents.verdict),
         resolution = COALESCE($13, incidents.resolution), updated_at = now()`,
      [id(folder, eventId), folder, eventId, patch.system ?? "", patch.facility ?? "", patch.asset ?? "", patch.category ?? "unknown", patch.onset_unix ?? 0, patch.end_unix ?? null, patch.status ?? null, patch.visual_report ? JSON.stringify(patch.visual_report) : null, patch.verdict ?? null, patch.resolution ?? null],
    ),
  );
}

const UPSERT_DISPATCH = `INSERT INTO incidents (id, dataset, event_id, system_id, facility_id, asset_id, category, onset_ts, status, dispatch, updated_at)
       VALUES ($1,$2,$3,'','','','unknown', to_timestamp($4::double precision / 1000.0), $5, $6::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET dispatch = EXCLUDED.dispatch, status = COALESCE(NULLIF($5, ''), incidents.status), updated_at = now()`;

async function upsertDispatchRow(a: { folder: string; eventId: string; sentAt: number; status: string }) {
  const params = [id(a.folder, a.eventId), a.folder, a.eventId, a.sentAt, a.status, JSON.stringify(a)];
  try {
    await query(UPSERT_DISPATCH, params);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/dispatch/.test(msg)) throw e;
    await query(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS dispatch jsonb`);
    await query(UPSERT_DISPATCH, params);
  }
}

/** Full On-call thread snapshot. Creates a stub incident so messages.incident_id FK succeeds. */
export function saveDispatch(a: { folder: string; eventId: string; sentAt: number; status: string }): void {
  if (!dbConfigured()) return;
  swallow(upsertDispatchRow(a));
}

/** One text, out or in. Stub incident first (does not clobber dispatch jsonb) so the FK cannot race. */
export function logMessage(m: { folder: string; eventId: string; channel: string; direction: "out" | "in"; recipient?: string; body: string; payload?: unknown }): void {
  if (!dbConfigured()) return;
  swallow(
    (async () => {
      await query(
        `INSERT INTO incidents (id, dataset, event_id, system_id, facility_id, asset_id, category, onset_ts, status, updated_at)
         VALUES ($1,$2,$3,'','','','unknown', now(), 'awaiting', now())
         ON CONFLICT (id) DO NOTHING`,
        [id(m.folder, m.eventId), m.folder, m.eventId],
      );
      await query(`INSERT INTO messages (incident_id, channel, direction, recipient, body, payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`, [id(m.folder, m.eventId), m.channel, m.direction, m.recipient ?? null, m.body, m.payload ? JSON.stringify(m.payload) : null]);
    })(),
  );
}

/** Ticket reference. */
export function logTicket(folder: string, eventId: string, provider: string, externalId: string, url: string, assignee?: string): void {
  if (!dbConfigured()) return;
  swallow(query(`INSERT INTO tickets (incident_id, provider, external_id, url, assignee, state) VALUES ($1,$2,$3,$4,$5,'open')`, [id(folder, eventId), provider, externalId, url, assignee ?? null]));
}

export interface DispatchThreadRow {
  id: string;
  dataset: string;
  event_id: string;
  status: string;
  dispatch: unknown;
  messages: { ts: number; dir: string; text: string; recipient: string | null; payload: { intent?: string; by?: string; spaceId?: string } | null }[];
}

/** On-call threads (dispatch snapshot + messages), for hydrating the in-memory board after a restart. */
export async function listDispatchThreads(): Promise<DispatchThreadRow[]> {
  if (!dbConfigured()) return [];
  const sql = `SELECT i.id, i.dataset, i.event_id, i.status, i.dispatch,
            COALESCE(json_agg(json_build_object(
              'ts', (extract(epoch FROM m.ts) * 1000)::bigint,
              'dir', m.direction,
              'text', m.body,
              'recipient', m.recipient,
              'payload', m.payload
            ) ORDER BY m.ts) FILTER (WHERE m.id IS NOT NULL), '[]'::json) AS messages
     FROM incidents i
     LEFT JOIN messages m ON m.incident_id = i.id
     WHERE i.dispatch IS NOT NULL OR EXISTS (SELECT 1 FROM messages mm WHERE mm.incident_id = i.id)
     GROUP BY i.id
     ORDER BY i.updated_at DESC`;
  try {
    return await query<DispatchThreadRow>(sql);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/dispatch/.test(msg)) throw e;
    return query<DispatchThreadRow>(
      `SELECT i.id, i.dataset, i.event_id, i.status, NULL::jsonb AS dispatch,
              COALESCE(json_agg(json_build_object(
                'ts', (extract(epoch FROM m.ts) * 1000)::bigint,
                'dir', m.direction,
                'text', m.body,
                'recipient', m.recipient,
                'payload', m.payload
              ) ORDER BY m.ts) FILTER (WHERE m.id IS NOT NULL), '[]'::json) AS messages
       FROM incidents i
       JOIN messages m ON m.incident_id = i.id
       GROUP BY i.id
       ORDER BY i.updated_at DESC`,
    );
  }
}

// ─── Live Incident Response persistence ──────────────────────────────────────

import type { IncidentLive } from "@/lib/live/types";

/**
 * Persist the live session snapshot (runbook state, notes, report, maxSeq).
 * Creates a stub row if the incident never reached the board, so the FK from messages works.
 * Silent no-op when DATABASE_URL is not configured.
 */
export function saveLive(folder: string, eventId: string, live: IncidentLive): void {
  if (!dbConfigured()) return;
  swallow(
    (async () => {
      await query(
        `INSERT INTO incidents (id, dataset, event_id, system_id, facility_id, asset_id, category, onset_ts, status, live, updated_at)
         VALUES ($1,$2,$3,'','','','unknown', now(), 'ongoing', $4::jsonb, now())
         ON CONFLICT (id) DO UPDATE SET live = $4::jsonb, updated_at = now()`,
        [id(folder, eventId), folder, eventId, JSON.stringify(live)],
      );
    })(),
  );
}

/**
 * Load the persisted live snapshot. Returns null when DATABASE_URL is not configured
 * or the row has no live data (the hub will serve from memory in that case).
 */
export async function loadLive(folder: string, eventId: string): Promise<IncidentLive | null> {
  if (!dbConfigured()) return null;
  const rows = await query<{ live: unknown }>(
    `SELECT live FROM incidents WHERE id = $1 AND live IS NOT NULL`,
    [id(folder, eventId)],
  );
  if (!rows.length || !rows[0].live) return null;
  return rows[0].live as IncidentLive;
}

// ─── Load final transcript messages for a session ─────────────────────────────

export async function loadLiveMessages(folder: string, eventId: string): Promise<{ ts: number; dir: string; body: string; payload: unknown }[]> {
  if (!dbConfigured()) return [];
  return query<{ ts: number; dir: string; body: string; payload: unknown }>(
    `SELECT (extract(epoch FROM ts) * 1000)::bigint AS ts, direction AS dir, body, payload
     FROM messages WHERE incident_id = $1 AND channel = 'gemini'
     ORDER BY ts ASC`,
    [id(folder, eventId)],
  );
}

/** Everything the database remembers, newest first, for the analytics page. */
export async function listIncidents(limit = 500) {
  if (!dbConfigured()) return [];
  return query<{ id: string; dataset: string; event_id: string; system_id: string; facility_id: string; asset_id: string; category: string; onset: number; end: number | null; status: string; confidence: number | null; plan: unknown; verdict: string | null; resolution: string | null; visual_report: unknown; messages: number }>(
    `SELECT i.id, i.dataset, i.event_id, i.system_id, i.facility_id, i.asset_id, i.category,
            extract(epoch FROM i.onset_ts)::bigint AS onset, extract(epoch FROM i.end_ts)::bigint AS "end",
            i.status, i.confidence, i.plan, i.verdict, i.resolution, i.visual_report,
            (SELECT count(*) FROM messages m WHERE m.incident_id = i.id)::int AS messages
     FROM incidents i ORDER BY i.updated_at DESC LIMIT $1`,
    [limit],
  );
}
