import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueJson, issueProject } from "@/lib/agent-api/issues";
import { IssueApiError } from "@/lib/agent-api/errors";
import { findIdea } from "@/lib/agent-api/ideas";
import { prisma } from "@/lib/prisma";
import { formatStructuredDescription, type IdeaStructureInput } from "@/lib/ideas";
import { audit } from "@/lib/agents/audit";
import { isPrivateFinding, PRIVATE_FINDING_EDIT_MESSAGE } from "@/lib/security-findings";

type Params = { id: string };

/**
 * POST /api/v1/ideas/:id/structure?projectId= — refine an unstructured draft
 * idea (by number or id) into a standard structured specification,
 * graduating it into the New ideas tab.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<Params> }) {
  const { id: ref } = await params;
  return agentIssueRequest(request, "ideas.structure", "working", ref, async (agent) => {
    const body = (await issueJson(request).catch(() => ({}))) as IdeaStructureInput & { title?: string; projectId?: string };
    const scope = await issueProject(agent, request.nextUrl.searchParams, body.projectId);
    const found = await findIdea(scope, ref);
    if (!found) throw new IssueApiError(404, "Idea not found.");
    const idea = await prisma.idea.findUniqueOrThrow({
      where: { id: found.id },
      select: { id: true, number: true, title: true, description: true, status: true },
    });
    if (idea.status !== "open") {
      throw new IssueApiError(400, "Only open ideas can be structured.");
    }
    if (await isPrivateFinding({ ideaId: idea.id })) {
      throw new IssueApiError(409, PRIVATE_FINDING_EDIT_MESSAGE, { error: "security_finding_private", message: PRIVATE_FINDING_EDIT_MESSAGE });
    }

    const nextTitle = body.title?.trim() || idea.title;
    const nextDescription = formatStructuredDescription(idea.description, body);

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.idea.update({
        where: { id: idea.id },
        data: { title: nextTitle, description: nextDescription },
        select: { id: true, number: true, title: true, description: true, status: true, updatedAt: true },
      });
      await audit(
        agent,
        "idea.structured",
        `idea:${idea.id}`,
        { beforeTitle: idea.title, afterTitle: nextTitle, beforeDescription: idea.description },
        { db: tx },
      );
      return saved;
    });

    return NextResponse.json({ ok: true, idea: updated }, { status: 200 });
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
