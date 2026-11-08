import { readdir } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const REQUIRED = ["network.json", "ops.json", "telemetry.csv"];

/** Lists every folder under public/data that holds the three dataset files. */
export async function GET() {
  const root = path.join(process.cwd(), "public", "data");
  let entries: string[] = [];
  try {
    entries = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return NextResponse.json([]);
  }
  const out = [];
  for (const folder of entries) {
    const files = await readdir(path.join(root, folder)).catch(() => [] as string[]);
    if (REQUIRED.every((f) => files.includes(f))) out.push({ folder, files });
  }
  // test/ first if present, then newest "now" last so full_week sits at the bottom.
  out.sort((a, b) => (a.folder === "test" ? -1 : b.folder === "test" ? 1 : a.folder.localeCompare(b.folder)));
  return NextResponse.json(out);
}
// No `dynamic` segment config: it is incompatible with cacheComponents, and GET handlers are dynamic by default.
