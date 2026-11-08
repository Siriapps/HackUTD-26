import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse, connection } from "next/server";

/**
 * Session outcomes → training data. POST appends one record to data/outcomes/session.json, the
 * file the nightly retrain merges (verdicts, resolution notes, visual reports). GET lists them.
 * Body: { folder, event_id, asset, facility, system, category, onset_unix, end_unix?, verdict?,
 *         resolution?: string, report?: object, by?: string }
 */
const FILE = path.join(process.cwd(), "data", "outcomes", "session.json");

async function load(): Promise<Record<string, unknown>[]> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as Record<string, unknown>[];
  } catch {
    return [];
  }
}

export async function GET() {
  await connection();
  return NextResponse.json(await load());
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b.event_id !== "string" || typeof b.folder !== "string" || typeof b.category !== "string") {
    return NextResponse.json({ ok: false, reason: "folder, event_id and category are required" }, { status: 400 });
  }
  const rows = await load();
  const key = `${b.folder}|${b.event_id}`;
  const rec = { ...rows.find((r) => `${r.folder}|${r.event_id}` === key), ...b, recorded_at: new Date().toISOString() };
  const next = [...rows.filter((r) => `${r.folder}|${r.event_id}` !== key), rec];
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(next, null, 2) + "\n");
  return NextResponse.json({ ok: true, count: next.length, file: "data/outcomes/session.json" });
}
