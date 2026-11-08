import { NextResponse, connection } from "next/server";
import { allowedRepos, githubConfigured, listActionIssues, openActionIssue, type IssueContext } from "@/lib/github/issue";
import { logTicket } from "@/lib/db/incidents";

/** Issues already filed for this event, plus the repositories the operator may target. */
export async function GET(req: Request) {
  await connection();
  const url = new URL(req.url);
  const folder = url.searchParams.get("folder") ?? "";
  const eventId = url.searchParams.get("eventId") ?? "";
  if (!folder || !eventId) return NextResponse.json({ ok: false, reason: "folder and eventId are required" }, { status: 400 });
  const issues = await listActionIssues(folder, eventId);
  return NextResponse.json({ configured: githubConfigured(), repos: allowedRepos(), issues });
}

interface Body {
  folder?: unknown;
  eventId?: unknown;
  actionItemId?: unknown;
  title?: unknown;
  detail?: unknown;
  tone?: unknown;
  repo?: unknown;
  context?: IssueContext;
}

/** Confirm an action item into a GitHub issue. The body is rebuilt here so the severity line and trace marker stay intact. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return NextResponse.json({ ok: false, reason: "folder, eventId, actionItemId, and title are required" }, { status: 400 });
  const origin = (process.env.PUBLIC_BASE_URL || new URL(req.url).origin).replace(/\/$/, "");
  const eventId = typeof body.eventId === "string" ? body.eventId : "";
  const folder = typeof body.folder === "string" ? body.folder : "";
  const threadUrl = `${origin}/dispatch/${encodeURIComponent(eventId)}?folder=${encodeURIComponent(folder)}`;
  const result = await openActionIssue(
    {
      folder,
      eventId,
      actionItemId: typeof body.actionItemId === "string" ? body.actionItemId : "",
      title: typeof body.title === "string" ? body.title : "",
      detail: typeof body.detail === "string" ? body.detail : undefined,
      tone: typeof body.tone === "string" ? body.tone : "",
      repo: typeof body.repo === "string" ? body.repo : undefined,
      threadUrl,
      context: body.context,
    },
    { logTicket },
  );
  if (!result.ok) return NextResponse.json({ ok: false, reason: result.reason }, { status: result.status });
  return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
}
