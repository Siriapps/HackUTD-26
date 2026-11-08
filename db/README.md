# Tiger Data (TimescaleDB) — synthetic telemetry store + shared persistence

1. Create a Tiger Cloud service (TimescaleDB) and copy its connection string.
2. Put it in `.env.local` as `DATABASE_URL=postgres://...` (never commit it).
3. Load the schema and every dataset folder (idempotent, ~1.4 M rows for the five history folders):
   ```
   npx dotenv -e .env.local -- npx tsx scripts/db/ingest.ts
   # or: DATABASE_URL=... npx tsx scripts/db/ingest.ts full_week
   ```
4. Check: `curl localhost:3000/api/db/status` → `{"configured":true,"connected":true,"datasets":[...]}`.

What lives where (`db/schema.sql`):

| Table / view | Written by | Purpose |
|---|---|---|
| `telemetry` (hypertable, 1-day chunks), `telemetry_1h` (continuous aggregate) | `scripts/db/ingest.ts` | synthetic SCADA telemetry per dataset; `/api/trends` serves long ranges |
| `datasets` | ingest | network.json / ops.json / time range per folder |
| `incidents` | P4 (memory, visual reports, verdicts, resolutions) | shared incident memory across machines |
| `messages`, `tickets` | P3 (Discord / Photon / GitHub issues) | what was sent, replies, ticket state |
| `outcomes`, `calibration` | P1 (nightly retrain) | outcome history and calibration versions |

Rule: the browser `analyse()` on the loaded folder remains the source of truth for detection and plans
(judging requires running from the three files with no hardcoding). With `DATABASE_URL` unset every
route answers `connected:false` and the app works unchanged.
