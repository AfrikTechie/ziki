import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { agentIssueRequest, issueProject } from "@/lib/agent-api/issues";
import { issueIdFor } from "@/lib/issue-ref";
import { FRESH_FOR_MS, storedGitHubStatus, syncPullRequestStatus } from "@/lib/github/sync";

export const runtime = "nodejs";

/**
 * GET /api/v1/issues/{id}/github?projectId=… (#github-status): the issue's
 * linked pull request as Ziki reads it on GitHub, and what is in the way of
 * merging it. Ziki reads GitHub again when its last read is older than a
 * minute (`?fresh=1` forces a read). The read is recorded as the issue's
 * latest pull request report, so the merge gate, the work feed and triage see
 * it too.
 *
 *   200 { pullRequestUrl, checkedAt, cached,
 *         verdict: "ready" | "blocked" | "waiting" | "merged" | "closed" | "not_found",
 *         headline, canMerge,
 *         blockers: [{ kind, level, title, detail, who, actions, links }],
 *         sendBackNote,            // what to tell the fixer, or null
 *         pullRequest: { …snapshot: state, draft, mergeable, headSha, baseRef, behindBy, checks[], reviews[] } }
 *
 * 409 `no_pull_request` / `other_repository`; 502 `github` when GitHub
 * couldn't be read (the last stored read, if any, comes back in `stored`).
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "issue.github_status", "read", id, async (agent) => {
    const scope = await issueProject(agent, request.nextUrl.searchParams);
    const bugId = await issueIdFor(prisma, id, agent.tenantId);
    const bug = bugId
      ? await prisma.bug.findFirst({ where: { id: bugId, tenantId: agent.tenantId, projectId: scope.projectId, isDeleted: false }, select: { id: true, pullRequestUrl: true } })
      : null;
    if (!bug) return NextResponse.json({ error: "not_found", message: "No such issue in this project." }, { status: 404 });

    const fresh = request.nextUrl.searchParams.get("fresh") === "1";
    const result = await syncPullRequestStatus(bug.id, fresh ? {} : { maxAgeMs: FRESH_FOR_MS });
    if (!result.ok) {
      const stored = result.error === "github" ? await storedGitHubStatus(bug) : null;
      return NextResponse.json(
        { error: result.error, message: result.message, ...(stored ? { stored: view(stored, true) } : {}) },
        { status: result.error === "github" ? 502 : 409 },
      );
    }
    return NextResponse.json(view(result.status, result.cached));
  });
}

function view(status: NonNullable<Awaited<ReturnType<typeof storedGitHubStatus>>>, cached: boolean) {
  const { diagnosis, snapshot } = status;
  return {
    pullRequestUrl: status.pullRequestUrl,
    checkedAt: status.checkedAt,
    cached,
    verdict: diagnosis.verdict,
    headline: diagnosis.headline,
    canMerge: diagnosis.canMerge,
    blockers: diagnosis.blockers,
    sendBackNote: diagnosis.sendBackNote,
    pullRequest: snapshot,
  };
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "OPTIONS"]);
export const POST = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const HEAD = apiMethodNotAllowed;
export const OPTIONS = createOptions(["GET", "OPTIONS"]);
