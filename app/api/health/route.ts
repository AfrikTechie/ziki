import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { cleanEnv } from "@/lib/env-clean";
import { deployedCommit } from "@/lib/deployed-version";
import { calculateVoteChange } from "@/lib/voting";
import { createdSummary } from "@/lib/activity-log";
import {
  isSuperAdmin,
  resolveEffectiveRole,
  ACTIVE_ROLE_COOKIE_NAME,
} from "@/lib/roles";
import { isSuperAdminEmail } from "@/lib/super-admin";
import { defaultOrganisationProject } from "@/lib/organisation";
import { moveTo } from "@/lib/issue-substatus";

export const dynamic = "force-dynamic";

/** Thrown inside the self-test transaction to force a rollback while carrying results. */
class RollbackSignal extends Error {
  constructor(readonly result: Record<string, unknown>) {
    super("rollback");
  }
}

/** True when the current session belongs to an effective super admin. */
async function isSuperAdminRequest(): Promise<boolean> {
  try {
    const session = await auth();
    const id = session?.user?.id;
    const email = session?.user?.email?.toLowerCase();
    if (!id && !email) return false;
    const user = id
      ? await prisma.user.findUnique({
          where: { id },
          select: { id: true, role: true, email: true },
        })
      : await prisma.user.findUnique({
          where: { email: email! },
          select: { id: true, role: true, email: true },
        });
    const isRealSuper =
      user?.role === "super_admin" || isSuperAdminEmail(user?.email);
    const cookieStore = await cookies();
    const activeRoleOverride = cookieStore.get(ACTIVE_ROLE_COOKIE_NAME)?.value;
    const effectiveRole = resolveEffectiveRole({
      isRealSuperAdmin: isRealSuper,
      baseRole: user?.role,
      activeRoleOverride,
      currentUserId: user?.id,
    });
    return isSuperAdmin(effectiveRole);
  } catch {
    return false;
  }
}


/** Public: minimal `{status:"ok"}` (or 503 `{status:"degraded"}` if DB down), plus the deployed commit when known. Super admin: full diagnostics and `?test=crud` self-test. */
export async function GET(request: NextRequest) {
  if (!(await isSuperAdminRequest())) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return NextResponse.json({ status: "ok", commit: deployedCommit() });
    } catch {
      return NextResponse.json({ status: "degraded" }, { status: 503 });
    }
  }

  const googleClientId = cleanEnv(
    process.env.GOOGLE_CLIENT_ID || process.env.AUTH_GOOGLE_ID,
  );
  const googleClientSecret = cleanEnv(
    process.env.GOOGLE_CLIENT_SECRET || process.env.AUTH_GOOGLE_SECRET,
  );

  let dbOk = false;
  const schemaStatus: Record<string, boolean> = {};
  const schemaErrors: string[] = [];

  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;

    const columns: Array<{ table_name: string; column_name: string }> =
      await prisma.$queryRaw`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (
            (table_name = 'User' AND column_name IN ('role', 'passwordHash', 'emailVerified')) OR
            (table_name = 'Vote' AND column_name IN ('value', 'userId', 'bugId')) OR
            (table_name = 'Bug' AND column_name IN ('proofLinks', 'voteCount', 'status')) OR
            (table_name = 'BugActivity' AND column_name IN ('type', 'summary', 'metadata')) OR
            (table_name = 'Comment' AND column_name IN ('parentId', 'body'))
          )
      `;

    for (const c of columns) {
      schemaStatus[`${c.table_name}.${c.column_name}`] = true;
    }
  } catch (error) {
    dbOk = false;
    schemaErrors.push(error instanceof Error ? error.message : String(error));
  }

  const searchParams = request.nextUrl.searchParams;
  let crudVerification: Record<string, unknown> | null = null;

  if (dbOk && searchParams.get("test") === "crud") {
    const testId = `health-check-${Date.now()}`;
    const testEmail = `${testId}@test.internal`;

    try {
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: testEmail,
            name: "Health Check User",
            role: "user",
          },
        });

        const bug = await tx.bug.create({
          data: {
            ...(await defaultOrganisationProject(tx)),
            beneficiaryUserId: user.id,
            title: `Health Check Bug ${testId}`,
            description:
              "Testing bug creation and voting lifecycle in production DB",
            ...moveTo("open"),
            proofLinks: ["https://github.com/Zedu-Endor/bug-tracker/issues/99"],
            reporterId: user.id,
            activities: {
              create: {
                actorId: user.id,
                type: "created",
                summary: createdSummary(`Health Check Bug ${testId}`),
              },
            },
          },
        });

        const { nextVote: upVoteVal, countDelta: upDelta } =
          calculateVoteChange(0, 1);
        await tx.vote.create({
          data: { userId: user.id, bugId: bug.id, value: upVoteVal },
        });
        const bugUpvoted = await tx.bug.update({
          where: { id: bug.id },
          data: { voteCount: { increment: upDelta } },
        });

        const { nextVote: downVoteVal, countDelta: downDelta } =
          calculateVoteChange(1, -1);
        await tx.vote.update({
          where: { userId_bugId: { userId: user.id, bugId: bug.id } },
          data: { value: downVoteVal },
        });
        const bugDownvoted = await tx.bug.update({
          where: { id: bug.id },
          data: { voteCount: { increment: downDelta } },
        });

        const { countDelta: unDelta } = calculateVoteChange(-1, -1);
        await tx.vote.delete({
          where: { userId_bugId: { userId: user.id, bugId: bug.id } },
        });
        const bugUnvoted = await tx.bug.update({
          where: { id: bug.id },
          data: { voteCount: { increment: unDelta } },
        });

        const rootComment = await tx.comment.create({
          data: {
            bugId: bug.id,
            authorId: user.id,
            body: "Root comment test",
          },
        });
        const replyComment = await tx.comment.create({
          data: {
            bugId: bug.id,
            authorId: user.id,
            body: "Threaded reply test",
            parentId: rootComment.id,
          },
        });

        throw new RollbackSignal({
          success: true,
          userCreated: user.role === "user",
          bugCreated: bug.proofLinks.length === 1,
          upvoteSuccess: bugUpvoted.voteCount === 1,
          downvoteSuccess: bugDownvoted.voteCount === -1,
          unvoteSuccess: bugUnvoted.voteCount === 0,
          threadedCommentSuccess: replyComment.parentId === rootComment.id,
          rolledBack: true,
        });
      });
    } catch (crudErr) {
      crudVerification =
        crudErr instanceof RollbackSignal
          ? crudErr.result
          : {
              success: false,
              error:
                crudErr instanceof Error ? crudErr.message : String(crudErr),
            };
    }
  }

  const expectedColumns = [
    "User.role",
    "User.passwordHash",
    "User.emailVerified",
    "Vote.value",
    "Vote.userId",
    "Vote.bugId",
    "Bug.proofLinks",
    "Bug.voteCount",
    "BugActivity.type",
    "BugActivity.summary",
    "Comment.parentId",
  ];

  const allColumnsPresent = expectedColumns.every(
    (col) => schemaStatus[col] === true,
  );

  const isHealthy = dbOk && allColumnsPresent;

  return NextResponse.json(
    {
      status: isHealthy ? "healthy" : "degraded",
      commit: deployedCommit(),
      uptime: process.uptime(),
      db: dbOk,
      schemaSynced: allColumnsPresent,
      schemaStatus,
      crudVerification,
      schemaErrors: schemaErrors.length > 0 ? schemaErrors : undefined,
      auth: {
        googleConfigured: Boolean(googleClientId) && Boolean(googleClientSecret),
        clientIdPrefix: googleClientId ? `${googleClientId.slice(0, 10)}…` : null,
        authSecretSet: Boolean(
          cleanEnv(process.env.AUTH_SECRET) ||
            cleanEnv(process.env.NEXTAUTH_SECRET),
        ),
        superAdminConfigured: Boolean(
          cleanEnv(process.env.SUPER_ADMIN_EMAIL) ||
            cleanEnv(process.env.SUPER_ADMIN_EMAILS),
        ),
      },
    },
    {
      status: isHealthy ? 200 : 503,
    },
  );
}
