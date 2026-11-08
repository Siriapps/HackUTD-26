import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const REQUIRED = ["network.json", "ops.json", "telemetry.csv"] as const;

/**
 * POST multipart: fields network.json, ops.json, telemetry.csv (+ optional `name`).
 * Writes public/data/<name>/ so the folder picker and /api/datasets see it immediately.
 * Judges' folder goes in through the drop zone; nothing about it is special-cased.
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "multipart form expected" }, { status: 400 });
  const files = REQUIRED.map((n) => [n, form.get(n)] as const);
  const missing = files.filter(([, f]) => !(f instanceof File)).map(([n]) => n);
  if (missing.length) return NextResponse.json({ error: `missing ${missing.join(", ")}` }, { status: 400 });
  const raw = String(form.get("name") ?? `upload_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}`);
  const name = raw.replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 64) || "upload";
  // Validate the JSON before writing anything.
  for (const [n, f] of files) {
    if (n === "telemetry.csv") continue;
    try {
      JSON.parse(await (f as File).text());
    } catch {
      return NextResponse.json({ error: `${n} is not valid JSON` }, { status: 400 });
    }
  }
  const dir = path.join(process.cwd(), "public", "data", name);
  await mkdir(dir, { recursive: true });
  let rows = 0;
  for (const [n, f] of files) {
    const buf = Buffer.from(await (f as File).arrayBuffer());
    if (n === "telemetry.csv") rows = Math.max(0, buf.toString("utf8").split("\n").length - 1);
    await writeFile(path.join(dir, n), buf);
  }
  return NextResponse.json({ ok: true, folder: name, rows });
}
