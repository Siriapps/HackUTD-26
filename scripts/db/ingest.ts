/**
 * Apply db/schema.sql and load every public/data/<folder>/ into Tiger Data (TimescaleDB).
 *
 *   npx tsx scripts/db/ingest.ts [folder ...]        (from the repo root; needs DATABASE_URL)
 *
 * Idempotent: telemetry rows are UNIQUE (dataset, asset_id, metric, ts) and inserted with
 * ON CONFLICT DO NOTHING; the datasets row is upserted. Answer keys are never read.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "public", "data");
const REQUIRED = ["network.json", "ops.json", "telemetry.csv"];
const BATCH = 5000;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set (put it in .env.local and run with: npx dotenv -e .env.local -- npx tsx scripts/db/ingest.ts, or export it)");
    process.exit(2);
  }
  const pool = new Pool({ connectionString: url, max: 2, ssl: url.includes("localhost") ? undefined : { rejectUnauthorized: false } });
  const wanted = process.argv.slice(2);
  const folders = readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && REQUIRED.every((f) => existsSync(path.join(DATA_DIR, d.name, f))))
    .map((d) => d.name)
    .filter((f) => !wanted.length || wanted.includes(f))
    .sort();

  const client = await pool.connect();
  try {
    console.log("applying db/schema.sql");
    await client.query(readFileSync(path.join(ROOT, "db", "schema.sql"), "utf8"));

    for (const folder of folders) {
      const dir = path.join(DATA_DIR, folder);
      const network = readFileSync(path.join(dir, "network.json"), "utf8");
      const ops = readFileSync(path.join(dir, "ops.json"), "utf8");
      const lines = readFileSync(path.join(dir, "telemetry.csv"), "utf8").split("\n");
      const t0 = Date.now();
      let rows = 0;
      let first = Infinity;
      let last = -Infinity;
      let batch: (string | number)[] = [];
      let n = 0;
      const flush = async () => {
        if (!n) return;
        const values = Array.from({ length: n }, (_, i) => `(to_timestamp($${i * 4 + 1}), $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4}, '${folder}')`).join(",");
        await client.query(`INSERT INTO telemetry (ts, asset_id, metric, value, dataset) VALUES ${values} ON CONFLICT DO NOTHING`, batch);
        rows += n;
        batch = [];
        n = 0;
      };
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        const [, tu, asset, metric, value] = line.split(",");
        const t = +tu;
        if (t < first) first = t;
        if (t > last) last = t;
        batch.push(t, asset, metric, +value);
        if (++n >= BATCH) await flush();
      }
      await flush();
      await client.query(
        `INSERT INTO datasets (dataset, network, ops, first_ts, last_ts, rows) VALUES ($1, $2::jsonb, $3::jsonb, to_timestamp($4), to_timestamp($5), $6)
         ON CONFLICT (dataset) DO UPDATE SET network = EXCLUDED.network, ops = EXCLUDED.ops, first_ts = EXCLUDED.first_ts, last_ts = EXCLUDED.last_ts, rows = EXCLUDED.rows, ingested_at = now()`,
        [folder, network, ops, first, last, rows],
      );
      console.log(`${folder}: ${rows} rows in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }
    console.log("refreshing telemetry_1h");
    await client.query("CALL refresh_continuous_aggregate('telemetry_1h', NULL, NULL)");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
