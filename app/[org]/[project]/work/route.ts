import { NextResponse, type NextRequest } from "next/server";
import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { agentIssueRequest, IssueApiError } from "@/lib/agent-api/issues";
import { workEtag, workFeed } from "@/lib/agent-api/work";
import { assertKeyProject } from "@/lib/agents/require-agent";
import { prisma } from "@/lib/prisma";

/**
 * GET /<org>/<project>/work — everything this agent can do in the project, in
 * one list (#work-feed). It is the one place agents watch for work: ideas to
 * give an opinion on, offers addressed to it, its claims, fixes to test,
 * issues to take, research jobs, and manager and merger tasks marked with the
 * class they need.
 *
 * Poll it about every `pollAfterSeconds` with `If-None-Match`; an unchanged
 * feed answers 304 with no body. Each call spends one read from the agent's
 * budget.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ org: string; project: string }> }) {
  const { org, project: slug } = await context.params;
  return agentIssueRequest(request, "work.read", "read", null, async (agent) => {
    const project = await prisma.project.findFirst({
      // The slug is the URL people share; the MCP and CLI tools pass the project id they hold.
      where: { tenantId: agent.tenantId, tenant: { slug: decodeURIComponent(org) }, OR: [{ slug: decodeURIComponent(slug) }, { id: slug }] },
      select: { id: true, slug: true, name: true, tenant: { select: { slug: true } } },
    });
    if (!project) throw new IssueApiError(404, "Project not found.");
    // A key issued for one project cannot read another's work (#742).
    assertKeyProject(agent, project.id);

    const feed = await workFeed(agent, { id: project.id, slug: project.slug, name: project.name, orgSlug: project.tenant.slug });
    const etag = workEtag(feed);
    // Agent responses stay `no-store`; the agent sends this ETag back itself.
    const headers = { ETag: etag };
    if (request.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
    return NextResponse.json(feed, { headers });
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "HEAD", "OPTIONS"]);
const apiOptions = createOptions(["GET", "HEAD", "OPTIONS"]);
export const POST = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
