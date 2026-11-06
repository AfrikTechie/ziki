import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { agentIssueRequest } from "@/lib/agent-api/issues";
import { prisma } from "@/lib/prisma";
import { pointBalance } from "@/lib/points/balance";

const timestamp = z.string().datetime({ offset: true });
const dateBound = z.union([timestamp, z.string().date()]);

function parseBound(val: string | undefined, isTo: boolean): Date | undefined {
  if (!val) return undefined;
  if (val.length === 10) {
    return new Date(isTo ? `${val}T23:59:59.999Z` : `${val}T00:00:00.000Z`);
  }
  return new Date(val);
}

const balanceQuerySchema = z
  .object({
    from: dateBound.optional(),
    to: dateBound.optional(),
  })
  .refine(
    (query) => {
      const from = parseBound(query.from, false);
      const to = parseBound(query.to, true);
      return !from || !to || from.getTime() <= to.getTime();
    },
    { message: "`from` must not be after `to`." },
  );

/**
 * GET /api/v1/agents/me/points?from=&to= — the balance of the person this key
 * works for (#618), summed from the append-only PointEntry ledger inside the
 * agent's organisation. The owner's, never a stranger's: the person comes from the
 * agent row, as on every other route here.
 *
 * `from`/`to` are optional inclusive ISO-8601 bounds on when the entry was
 * written; with neither, the period covers everything and matches `lifetime`.
 * A date-only `to` bound includes the entire UTC day through 23:59:59.999Z.
 * Non-ISO strings return 400.
 * The wallet address is deliberately not in this response: it is readable only
 * by the person and organisation admins, and an agent is neither.
 *
 * Rate: charged as a read. Audited as `points.balance`.
 */
export async function GET(request: NextRequest) {
  return agentIssueRequest(request, "points.balance", "read", null, async (agent) => {
    const parsed = balanceQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "from and to must be ISO-8601 dates, and from must not be after to." },
        { status: 400 },
      );
    }

    const from = parseBound(parsed.data.from, false);
    const to = parseBound(parsed.data.to, true);

    const balance = await pointBalance(prisma, {
      organisationId: agent.organisationId,
      userId: agent.ownerId,
      from,
      to,
    });

    return NextResponse.json({
      user_id: agent.ownerId,
      organisation_id: agent.organisationId,
      lifetime: balance.lifetime,
      period: balance.period,
    });
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "HEAD", "OPTIONS"]);
const apiOptions = createOptions(["GET", "HEAD", "OPTIONS"]);
export const POST = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
