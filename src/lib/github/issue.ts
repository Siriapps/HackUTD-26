// Turn one operator action item into a GitHub issue. The token stays on the server.
import { ledgerKey, readLedger, withIssueLock, writeLedger, type IssueSeverity, type LedgerIssue } from "./ledger";

export type { IssueSeverity };

export const SEVERITY_LABEL: Record<IssueSeverity, { name: string; color: string; description: string }> = {
  critical: {
    name: "severity: critical",
    color: "b91c1c",
    description: "Do first. Handle this before other open operator issues.",
  },
  normal: {
    name: "severity: normal",
    color: "a16207",
    description: "Then. Handle this after critical operator issues.",
  },
};

/** Do-first items outrank later steps. Anything else is not a task. */
export function severityForTone(tone: string): IssueSeverity | null {
  if (tone === "urgent") return "critical";
  if (tone === "next") return "normal";
  return null;
}

export interface IssueContext {
  facility?: string;
  asset?: string;
  category?: string;
}

export interface IssueDraftInput {
  folder: string;
  eventId: string;
  actionItemId: string;
  title: string;
  detail?: string;
  severity: IssueSeverity;
  threadUrl: string;
  context?: IssueContext;
}

export interface IssueDraft {
  title: string;
  body: string;
  severity: IssueSeverity;
  label: string;
}

export interface FiledIssue {
  actionItemId: string;
  repo: string;
  number: number;
  url: string;
  severity: IssueSeverity;
}

export interface OpenActionInput {
  folder: string;
  eventId: string;
  actionItemId: string;
  title: string;
  detail?: string;
  tone: string;
  repo?: string;
  threadUrl: string;
  context?: IssueContext;
}

export type OpenActionResult =
  | { ok: true; duplicate: boolean; repo: string; number: number; url: string; actionItemId: string; severity: IssueSeverity }
  | { ok: false; status: 400 | 502 | 503; reason: string };

type Env = Record<string, string | undefined>;

const GH_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
  "User-Agent": "avon-night-shift",
};

export function allowedRepos(env: Env = process.env): string[] {
  const raw = env.GITHUB_ISSUE_REPOS || env.TICKET_REPO || "";
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
}

export function githubConfigured(env: Env = process.env): boolean {
  return Boolean(env.GITHUB_TOKEN?.trim()) && allowedRepos(env).length > 0;
}

function marker(folder: string, eventId: string, actionItemId: string): string {
  return `<!-- avon-action:${folder}|${eventId}|${actionItemId} -->`;
}

function clip(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

export function buildIssueDraft(input: IssueDraftInput): IssueDraft {
  const label = SEVERITY_LABEL[input.severity].name;
  const lines = [
    `**Severity:** ${input.severity}`,
    "",
    input.title.trim(),
    ...(input.detail?.trim() ? ["", input.detail.trim()] : []),
    "",
    `**Event:** ${input.eventId}`,
    `**Folder:** ${input.folder}`,
    `**Action item:** ${input.actionItemId}`,
  ];
  const facility = clip(input.context?.facility, 200);
  const asset = clip(input.context?.asset, 200);
  const category = clip(input.context?.category, 200);
  if (facility) lines.push(`**Facility:** ${facility}`);
  if (asset) lines.push(`**Asset:** ${asset}`);
  if (category) lines.push(`**Category:** ${category}`);
  lines.push("", `**Thread:** ${input.threadUrl}`, "", marker(input.folder, input.eventId, input.actionItemId));
  return {
    title: `[${input.eventId}] ${input.title.trim()}`.slice(0, 200),
    body: lines.join("\n"),
    severity: input.severity,
    label,
  };
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

function repoPath(repo: string): string {
  const parts = repo.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1] || parts.some((p) => p === "." || p === "..")) {
    throw new GitHubError("Repository must be owner/name", 400);
  }
  return `${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}`;
}

interface GhResult {
  status: number;
  number?: number;
  url?: string;
}

async function gh(fetchImpl: typeof fetch, token: string, method: string, apiPath: string, body?: unknown): Promise<GhResult> {
  let res: Response;
  try {
    res = await fetchImpl(`https://api.github.com${apiPath}`, {
      method,
      headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new GitHubError("GitHub could not be reached", 502);
  }
  const json = (await res.json().catch(() => null)) as { number?: number; html_url?: string } | null;
  if (res.status === 201 && method === "POST" && apiPath.endsWith("/issues")) {
    if (typeof json?.number !== "number" || typeof json.html_url !== "string") {
      throw new GitHubError("GitHub returned an unexpected issue", 502);
    }
    return { status: res.status, number: json.number, url: json.html_url };
  }
  return { status: res.status };
}

/** Create the severity label when the repo does not have it yet. 422 means it already exists. */
export async function ensureSeverityLabel(fetchImpl: typeof fetch, token: string, repo: string, severity: IssueSeverity): Promise<void> {
  const spec = SEVERITY_LABEL[severity];
  const { status } = await gh(fetchImpl, token, "POST", `/repos/${repoPath(repo)}/labels`, {
    name: spec.name,
    color: spec.color,
    description: spec.description,
  });
  if (status === 201 || status === 422) return;
  if (status === 401) throw new GitHubError("GitHub rejected the token", 401);
  if (status === 404) throw new GitHubError("GitHub repository was not found", 404);
  if (status === 403) return;
  throw new GitHubError(`GitHub label request failed (${status})`, status);
}

export async function createGitHubIssue(fetchImpl: typeof fetch, token: string, repo: string, draft: IssueDraft): Promise<{ number: number; url: string }> {
  await ensureSeverityLabel(fetchImpl, token, repo, draft.severity);
  const path = `/repos/${repoPath(repo)}/issues`;
  const labeled = await gh(fetchImpl, token, "POST", path, { title: draft.title, body: draft.body, labels: [draft.label] });
  const created = labeled.status === 422 ? await gh(fetchImpl, token, "POST", path, { title: draft.title, body: draft.body }) : labeled;
  if (created.status === 201 && typeof created.number === "number" && created.url) return { number: created.number, url: created.url };
  if (created.status === 401 || created.status === 403) throw new GitHubError("GitHub rejected the token", created.status);
  if (created.status === 404) throw new GitHubError("GitHub repository was not found", created.status);
  throw new GitHubError(`GitHub issue request failed (${created.status})`, created.status);
}

function idPart(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v.length > 200 || /[\r\n|]/.test(v)) return null;
  return v;
}

function contextOf(ctx: IssueContext | undefined): IssueContext | undefined {
  if (!ctx) return undefined;
  const facility = clip(typeof ctx.facility === "string" ? ctx.facility : undefined, 200);
  const asset = clip(typeof ctx.asset === "string" ? ctx.asset : undefined, 200);
  const category = clip(typeof ctx.category === "string" ? ctx.category : undefined, 200);
  if (!facility && !asset && !category) return undefined;
  return { facility, asset, category };
}

function toPublic(row: LedgerIssue): FiledIssue {
  return { actionItemId: row.actionItemId, repo: row.repo, number: row.number, url: row.url, severity: row.severity };
}

export async function listActionIssues(folder: string, eventId: string): Promise<FiledIssue[]> {
  const rows = await readLedger();
  return rows.filter((r) => r.folder === folder && r.eventId === eventId).map(toPublic);
}

function fail(status: 400 | 502 | 503, reason: string): OpenActionResult {
  return { ok: false, status, reason };
}

function fromGitHub(err: unknown): OpenActionResult {
  if (err instanceof GitHubError) {
    if (err.status === 400) return fail(400, err.message);
    if (err.status === 401 || err.status === 403) return fail(502, "GitHub rejected the token");
    if (err.status === 404) return fail(502, "GitHub repository was not found");
    if (err.message === "GitHub could not be reached") return fail(502, err.message);
    return fail(502, "GitHub could not create the issue");
  }
  return fail(502, "GitHub could not create the issue");
}

export async function openActionIssue(
  input: OpenActionInput,
  deps: {
    fetchImpl?: typeof fetch;
    env?: Env;
    logTicket?: (folder: string, eventId: string, provider: string, externalId: string, url: string) => void;
  } = {},
): Promise<OpenActionResult> {
  const folder = idPart(input.folder);
  const eventId = idPart(input.eventId);
  const actionItemId = idPart(input.actionItemId);
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!folder || !eventId || !actionItemId || !title) return fail(400, "folder, eventId, actionItemId, and title are required");
  const severity = severityForTone(input.tone);
  if (!severity) return fail(400, "Only urgent and next action items can be filed");

  const env = deps.env ?? process.env;
  const repos = allowedRepos(env);
  const token = env.GITHUB_TOKEN?.trim() ?? "";
  if (!token || repos.length === 0) return fail(503, "GitHub is not configured");

  const requested = typeof input.repo === "string" && input.repo.trim() ? input.repo.trim() : repos[0];
  if (!repos.includes(requested)) return fail(400, "Repository is not allowed");

  const draft = buildIssueDraft({
    folder,
    eventId,
    actionItemId,
    title: title.slice(0, 180),
    detail: clip(input.detail, 4000),
    severity,
    threadUrl: input.threadUrl,
    context: contextOf(input.context),
  });
  const key = ledgerKey(folder, eventId, actionItemId);
  const fetchImpl = deps.fetchImpl ?? fetch;

  return withIssueLock(key, async () => {
    const existing = (await readLedger()).find((r) => ledgerKey(r.folder, r.eventId, r.actionItemId) === key);
    if (existing) return { ok: true, duplicate: true, ...toPublic(existing) };
    let created: { number: number; url: string };
    try {
      created = await createGitHubIssue(fetchImpl, token, requested, draft);
    } catch (err) {
      return fromGitHub(err);
    }
    const row: LedgerIssue = {
      folder,
      eventId,
      actionItemId,
      repo: requested,
      number: created.number,
      url: created.url,
      severity,
      createdAt: new Date().toISOString(),
    };
    const rows = await readLedger();
    if (!rows.some((r) => ledgerKey(r.folder, r.eventId, r.actionItemId) === key)) rows.push(row);
    await writeLedger(rows);
    deps.logTicket?.(folder, eventId, "github", String(created.number), created.url);
    return { ok: true, duplicate: false, ...toPublic(row) };
  });
}
