import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueJson, issueProject } from "@/lib/agent-api/issues";
import { repairPullRequestLink, repairPullRequestSchema } from "@/lib/agent-api/repair-pull-request";

export const runtime = "nodejs";

/**
 * POST /api/v1/issues/{id}/pull-request — the contributor holding or assigned
 * to the issue (or who delivered its pull request) updates their submitted
 * pull request link, or an independent manager or merger agent replaces an
 * issue's stale pull request link with one in the project's repository
 * (#repair-pr-link, #edit-pr-link). With no `pullRequestUrl`, the old link's
 * number in the project's repository. Ziki doesn't ask GitHub whether it
 * exists: the new link has no report yet, so an independent agent checks it
 * and reports it (#pr-reports). The same pull request under a former
 * repository name keeps its judgements, merge reviews and delivery; a
 * different one leaves judgements and merge reviews on the old address. Audited as
 * `issue.pull_request_repaired`, with the old address.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "issue.pull_request_repaired", "working", id, async (agent) => {
    const parsed = repairPullRequestSchema.safeParse(await issueJson(request));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_body", message: "Send at most a pullRequestUrl (a GitHub pull request URL) and a projectId." },
        { status: 400 },
      );
    }
    const { projectId, ...input } = parsed.data;
    const scope = await issueProject(agent, request.nextUrl.searchParams, projectId);
    const result = await repairPullRequestLink(agent, scope, id, input);
    return NextResponse.json(result.body, { status: result.status });
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["POST", "OPTIONS"]);
const apiOptions = createOptions(["POST", "OPTIONS"]);
export const GET = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const HEAD = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
