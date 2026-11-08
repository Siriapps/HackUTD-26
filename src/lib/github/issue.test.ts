import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildIssueDraft, openActionIssue, severityForTone } from "./issue";
import { readLedger } from "./ledger";

const env = {
  GITHUB_TOKEN: "ghp_test",
  TICKET_REPO: "owner/demo",
};

const input = {
  folder: "full_week",
  eventId: "FIX-PUMP",
  actionItemId: "undecided",
  tone: "urgent",
  title: "No decision yet on the plan",
  detail: "Alerted 5 h ago.",
  threadUrl: "https://console.example/dispatch/FIX-PUMP?folder=full_week",
  context: { facility: "Tank 2", asset: "P-2", category: "pump_failure" },
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function issueFetch(issueStatus = 201, labelStatus = 201) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url: href, body });
    if (href.endsWith("/labels")) return json(labelStatus, {});
    return json(issueStatus, issueStatus === 201 ? { number: 42, html_url: "https://github.com/owner/demo/issues/42" } : { message: "nope" });
  });
  return { fetchImpl, calls };
}

let dir = "";

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "gh-issues-"));
  process.env.GITHUB_ISSUE_LEDGER = path.join(dir, "github-issues.json");
});

afterEach(async () => {
  delete process.env.GITHUB_ISSUE_LEDGER;
  await rm(dir, { recursive: true, force: true });
});

describe("buildIssueDraft", () => {
  it("puts severity, the action, the event, the thread, and the marker in the issue", () => {
    const draft = buildIssueDraft({ ...input, severity: "critical" });
    expect(draft.title).toBe("[FIX-PUMP] No decision yet on the plan");
    expect(draft.label).toBe("severity: critical");
    expect(draft.body.startsWith("**Severity:** critical")).toBe(true);
    expect(draft.body).toContain("Alerted 5 h ago.");
    expect(draft.body).toContain("**Event:** FIX-PUMP");
    expect(draft.body).toContain("**Facility:** Tank 2");
    expect(draft.body).toContain(input.threadUrl);
    expect(draft.body).toContain("<!-- avon-action:full_week|FIX-PUMP|undecided -->");
  });

  it("maps do-first to critical and later steps to normal", () => {
    expect(severityForTone("urgent")).toBe("critical");
    expect(severityForTone("next")).toBe("normal");
    expect(severityForTone("info")).toBeNull();
    expect(buildIssueDraft({ ...input, severity: "normal" }).label).toBe("severity: normal");
  });
});

describe("openActionIssue", () => {
  it("creates a labeled issue and records it", async () => {
    const { fetchImpl, calls } = issueFetch();
    const logTicket = vi.fn();
    const created = await openActionIssue(input, { fetchImpl, env, logTicket });
    expect(created).toMatchObject({ ok: true, duplicate: false, number: 42, severity: "critical", url: "https://github.com/owner/demo/issues/42" });
    expect(calls[0].url).toBe("https://api.github.com/repos/owner/demo/labels");
    expect(calls[0].body).toMatchObject({ name: "severity: critical", color: "b91c1c" });
    expect(calls[1].body).toMatchObject({ labels: ["severity: critical"], title: "[FIX-PUMP] No decision yet on the plan" });
    expect(logTicket).toHaveBeenCalledWith("full_week", "FIX-PUMP", "github", "42", "https://github.com/owner/demo/issues/42");
    const ledger = await readLedger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0].severity).toBe("critical");
  });

  it("does not call GitHub again for the same action item", async () => {
    const { fetchImpl } = issueFetch();
    await openActionIssue(input, { fetchImpl, env });
    fetchImpl.mockClear();
    const again = await openActionIssue({ ...input, detail: "changed later" }, { fetchImpl, env });
    expect(again).toMatchObject({ ok: true, duplicate: true, number: 42 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await readLedger()).toHaveLength(1);
  });

  it("lets one of two overlapping confirms create the issue", async () => {
    let posts = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/labels")) return json(201, {});
      posts += 1;
      await gate;
      return json(201, { number: 7, html_url: "https://github.com/owner/demo/issues/7" });
    });
    const pending = Promise.all([openActionIssue(input, { fetchImpl, env }), openActionIssue(input, { fetchImpl, env })]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(posts).toBe(1);
    release();
    const [a, b] = await pending;
    expect([a, b].filter((r) => r.ok && r.duplicate)).toHaveLength(1);
    expect([a, b].every((r) => r.ok && r.number === 7)).toBe(true);
    expect(await readLedger()).toHaveLength(1);
  });

  it("refuses to file when GitHub is not configured", async () => {
    const fetchImpl = vi.fn();
    const missing = await openActionIssue(input, { fetchImpl, env: { TICKET_REPO: "owner/demo" } });
    expect(missing).toEqual({ ok: false, status: 503, reason: "GitHub is not configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await readLedger()).toEqual([]);
  });

  it("does not record an issue when GitHub rejects the token", async () => {
    const { fetchImpl } = issueFetch(401, 401);
    const rejected = await openActionIssue(input, { fetchImpl, env });
    expect(rejected).toEqual({ ok: false, status: 502, reason: "GitHub rejected the token" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await readLedger()).toEqual([]);
  });

  it("rejects a repository that is not allowlisted", async () => {
    const fetchImpl = vi.fn();
    const rejected = await openActionIssue({ ...input, repo: "other/repo" }, { fetchImpl, env: { ...env, GITHUB_ISSUE_REPOS: "owner/demo,owner/other" } });
    expect(rejected).toEqual({ ok: false, status: 400, reason: "Repository is not allowed" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retries without a label when GitHub cannot attach one, and still records severity", async () => {
    const calls: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      if (String(url).endsWith("/labels")) return json(422, { message: "already exists" });
      calls.push(body);
      if (body.labels) return json(422, { message: "label missing" });
      return json(201, { number: 9, html_url: "https://github.com/owner/demo/issues/9" });
    });
    const created = await openActionIssue({ ...input, tone: "next" }, { fetchImpl, env });
    expect(created).toMatchObject({ ok: true, severity: "normal", number: 9 });
    expect(calls[0].labels).toEqual(["severity: normal"]);
    expect(calls[1].labels).toBeUndefined();
    expect(String(calls[1].body)).toContain("**Severity:** normal");
    expect((await readLedger())[0].severity).toBe("normal");
  });
});
