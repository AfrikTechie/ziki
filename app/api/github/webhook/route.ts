import { after, NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { issuesForPullRequest, syncPullRequestStatus } from "@/lib/github/sync";
import { signatureMatches } from "@/lib/github/webhook-signature";

export const runtime = "nodejs";

/**
 * POST /api/github/webhook (#github-status): GitHub tells Ziki the moment a
 * linked pull request changes, so the issue page and the merge gate don't
 * wait for the next sweep. Point the project's GitHub App (or a repository
 * webhook) here with the secret in GITHUB_WEBHOOK_SECRET, for the events
 * `pull_request`, `pull_request_review`, `check_run`, `check_suite` and
 * `status`. Ziki then reads the pull request itself; it never trusts the
 * payload's state.
 */

const EVENTS = new Set(["pull_request", "pull_request_review", "check_run", "check_suite", "status", "ping"]);
/** One delivery never re-reads more than this many issues. */
const MAX_ISSUES = 20;

type Payload = {
  repository?: { name?: string; owner?: { login?: string } };
  pull_request?: { number?: number; head?: { sha?: string } };
  check_run?: { head_sha?: string; pull_requests?: { number: number }[] };
  check_suite?: { head_sha?: string; pull_requests?: { number: number }[] };
  sha?: string;
};

async function issuesFor(event: string, payload: Payload): Promise<string[]> {
  const owner = payload.repository?.owner?.login;
  const repo = payload.repository?.name;
  if (!owner || !repo) return [];
  const numbers = new Set<number>();
  const shas = new Set<string>();
  if (payload.pull_request?.number) numbers.add(payload.pull_request.number);
  for (const run of [payload.check_run, payload.check_suite]) {
    for (const pr of run?.pull_requests ?? []) numbers.add(pr.number);
    if (run?.head_sha) shas.add(run.head_sha);
  }
  if (event === "status" && payload.sha) shas.add(payload.sha);

  const ids = new Set<string>();
  for (const number of numbers) for (const id of await issuesForPullRequest(owner, repo, number)) ids.add(id);
  // Pull requests from forks don't appear in check payloads: match the head commit.
  if (shas.size) {
    const rows = await prisma.bug.findMany({
      where: { isDeleted: false, pullRequestHeadSha: { in: [...shas] }, pullRequestUrl: { startsWith: `https://github.com/${owner}/${repo}/pull/`, mode: "insensitive" } },
      select: { id: true },
      take: MAX_ISSUES,
    });
    for (const row of rows) ids.add(row.id);
  }
  return [...ids].slice(0, MAX_ISSUES);
}

export async function POST(request: NextRequest) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "GitHub webhooks are not configured (GITHUB_WEBHOOK_SECRET)." }, { status: 503 });
  const body = await request.text();
  if (!signatureMatches(body, request.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ error: "Bad signature." }, { status: 401 });
  }
  const event = request.headers.get("x-github-event") ?? "";
  if (!EVENTS.has(event) || event === "ping") return NextResponse.json({ ok: true, ignored: event === "ping" ? undefined : event });

  let payload: Payload;
  try {
    payload = JSON.parse(body) as Payload;
  } catch {
    return NextResponse.json({ error: "Body is not JSON." }, { status: 400 });
  }
  const ids = await issuesFor(event, payload);
  // Answer GitHub at once (it waits ten seconds at most); read after.
  after(async () => {
    for (const id of ids) {
      const result = await syncPullRequestStatus(id);
      if (!result.ok && result.error === "github") console.warn("[github-webhook] read failed", id, result.message);
    }
  });
  return NextResponse.json({ ok: true, issues: ids.length }, { status: 202 });
}
