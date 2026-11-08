import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

const run = promisify(execFile);

/**
 * POST { title, body, labels? } → opens a GitHub issue in TICKET_REPO (default: this repo) and
 * returns its URL. Uses the GitHub CLI's own login on the demo machine, so no token lands in
 * the app. Without `gh`, answers 503 with the ticket text so the UI can still show it.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { title?: string; body?: string; labels?: string[] };
  if (!body.title) return NextResponse.json({ ok: false, reason: "title required" }, { status: 400 });
  const repo = process.env.TICKET_REPO || "Siriapps/HackUTD-26";
  const args = ["issue", "create", "--repo", repo, "--title", body.title.slice(0, 200), "--body", body.body ?? ""];
  for (const l of body.labels ?? []) args.push("--label", l);
  try {
    const { stdout } = await run("gh", args, { timeout: 20_000, windowsHide: true });
    const url = stdout.trim().split("\n").pop() ?? "";
    return NextResponse.json({ ok: true, url, repo });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, reason: `ticket not created (${msg.split("\n")[0].slice(0, 160)})`, draft: { repo, ...body } }, { status: 503 });
  }
}
