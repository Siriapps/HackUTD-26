import { NextResponse, type NextRequest } from "next/server";
import { dbConfigured, query } from "@/lib/db";

/**
 * GET /api/trends?dataset=&asset=&metric=&from=<unix>&to=<unix>&bucket=raw|1h
 * Long-range series from Tiger Data. 503 with {connected:false} when no DATABASE_URL, so the
 * UI falls back to the in-browser series.
 */
export async function GET(req: NextRequest) {
  if (!dbConfigured()) return NextResponse.json({ connected: false, points: [] }, { status: 503 });
  const q = req.nextUrl.searchParams;
  const dataset = q.get("dataset");
  const asset = q.get("asset");
  const metric = q.get("metric");
  if (!dataset || !asset || !metric) return NextResponse.json({ error: "dataset, asset and metric are required" }, { status: 400 });
  const from = Number(q.get("from") ?? 0);
  const to = Number(q.get("to") ?? 4102444800);
  const bucket = q.get("bucket") === "1h" ? "1h" : "raw";
  try {
    const points =
      bucket === "1h"
        ? await query<{ t: number; avg: number; min: number; max: number }>(
            `SELECT extract(epoch FROM bucket)::bigint AS t, avg, min, max FROM telemetry_1h
             WHERE dataset = $1 AND asset_id = $2 AND metric = $3 AND bucket >= to_timestamp($4) AND bucket <= to_timestamp($5) ORDER BY bucket`,
            [dataset, asset, metric, from, to],
          )
        : await query<{ t: number; value: number }>(
            `SELECT extract(epoch FROM ts)::bigint AS t, value FROM telemetry
             WHERE dataset = $1 AND asset_id = $2 AND metric = $3 AND ts >= to_timestamp($4) AND ts <= to_timestamp($5) ORDER BY ts LIMIT 20000`,
            [dataset, asset, metric, from, to],
          );
    return NextResponse.json({ connected: true, bucket, points });
  } catch (e) {
    return NextResponse.json({ connected: false, error: e instanceof Error ? e.message : String(e), points: [] }, { status: 502 });
  }
}
