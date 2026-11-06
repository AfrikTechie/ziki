import { NextResponse } from "next/server";
import { resolveSessionUserId } from "@/lib/session-user";
import { currentOrganisationIdFor } from "@/lib/organisation-context";
import { loadOwnAgents } from "@/lib/dashboard-overview";

/**
 * The Overview agents table polls this every 30 seconds so the section can
 * refresh on its own without re-rendering the whole page. Read-only, scoped
 * to the signed-in owner's agents in the current organisation.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await resolveSessionUserId();
  if ("error" in session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  try {
    const organisationId = await currentOrganisationIdFor(session.userId);
    const agents = await loadOwnAgents({
      userId: session.userId,
      organisationId,
    });
    return NextResponse.json(
      {
        agents: agents.map((agent) => ({
          ...agent,
          lastSeenAt: agent.lastSeenAt ? agent.lastSeenAt.toISOString() : null,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[dashboard] agents poll failed", error);
    return NextResponse.json({ error: "Could not load agents" }, { status: 500 });
  }
}
