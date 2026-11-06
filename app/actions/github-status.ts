"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth-helpers";
import { tenantAccessFor } from "@/lib/tenant-access";
import { consumeRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { addCommentAction } from "@/app/actions/issues";
import { publish } from "@/lib/agent-api/events";
import { notifyAuthor } from "@/lib/agent-api/pull-request-report";
import { statusChangedSummary } from "@/lib/activity-log";
import { moveTo } from "@/lib/issue-substatus";
import { GitHubError, githubClientFor } from "@/lib/github/client";
import { mergePullRequest, rerunFailedChecks, updateBranch } from "@/lib/github/pull-request-actions";
import { parsePullRequestUrl } from "@/lib/github/pull-request-url";
import { githubStatusPowers, SEND_BACK_STATUSES, type GitHubStatusPowers } from "@/lib/github/status-access";
import { syncPullRequestStatus } from "@/lib/github/sync";

/**
 * The issue page's GitHub panel (#github-status): read the pull request on
 * GitHub again, fix what Ziki can fix there (update the branch, re-run failed
 * checks, merge), or send the fix back to its fixer with what GitHub says is
 * wrong. lib/github/status-access.ts says who may do each.
 */

export type GitHubActionResult = { ok: true; message: string } | { ok: false; error: string };

const NOTE_MAX_CHARS = 4000;
const GITHUB_ACTION_LIMIT = { max: 12, windowMs: 60_000 };

async function load(bugId: unknown) {
  if (typeof bugId !== "string" || !bugId) return null;
  const user = await requireUser();
  const bug = await prisma.bug.findFirst({
    where: { id: bugId, isDeleted: false },
    select: {
      id: true,
      number: true,
      title: true,
      tenantId: true,
      projectId: true,
      status: true,
      substatus: true,
      reporterId: true,
      beneficiaryUserId: true,
      pullRequestUrl: true,
      project: { select: { slug: true, githubInstallationId: true } },
      claims: {
        where: { status: { in: ["active", "released"] } },
        orderBy: { claimedAt: "desc" },
        take: 1,
        select: { id: true, status: true, agentId: true, beneficiaryUserId: true, agent: { select: { name: true } } },
      },
    },
  });
  if (!bug) return null;
  const [access, agents] = await Promise.all([
    tenantAccessFor(user.id, bug.tenantId, user.role),
    prisma.agent.findMany({ where: { tenantId: bug.tenantId, ownerUserId: user.id, revokedAt: null }, select: { level: true } }),
  ]);
  const powers = githubStatusPowers({
    member: Boolean(access.membershipRole),
    admin: access.admin,
    ownsIssue: bug.reporterId === user.id || bug.beneficiaryUserId === user.id,
    agentLevels: agents.map((agent) => agent.level),
  });
  return { user, bug, powers };
}

type Loaded = NonNullable<Awaited<ReturnType<typeof load>>>;

async function guard(bugId: unknown, power: keyof GitHubStatusPowers): Promise<Loaded | GitHubActionResult> {
  const loaded = await load(bugId);
  if (!loaded) return { ok: false, error: "Issue not found." };
  if (!loaded.powers[power]) {
    return {
      ok: false,
      error: power === "merge"
        ? "Only a workspace admin, or someone whose merger agent works here, can merge from Ziki."
        : "Only a workspace admin, the person this issue is for, or someone whose manager or merger agent works here can do that.",
    };
  }
  if (power !== "refresh") {
    const limit = await consumeRateLimit(`github-action:${loaded.user.id}`, GITHUB_ACTION_LIMIT);
    if (!limit.allowed) return { ok: false, error: RATE_LIMIT_MESSAGE };
  }
  return loaded;
}

const isResult = (value: Loaded | GitHubActionResult): value is GitHubActionResult => "ok" in value;

function refresh() {
  revalidatePath("/[org]/[project]", "layout");
}

function failure(error: unknown): GitHubActionResult {
  if (error instanceof GitHubError) return { ok: false, error: error.message };
  console.error("[github-status] action failed", error);
  return { ok: false, error: "Something went wrong talking to GitHub. Try again." };
}

/** Read the pull request on GitHub again now. */
export async function refreshGitHubStatusAction(bugId: string): Promise<GitHubActionResult> {
  const loaded = await guard(bugId, "refresh");
  if (isResult(loaded)) return loaded;
  const result = await syncPullRequestStatus(loaded.bug.id, { actorUserId: loaded.user.id });
  refresh();
  if (!result.ok) return { ok: false, error: result.message };
  return { ok: true, message: result.status.diagnosis.headline };
}

/** Read fresh, so every write acts on what GitHub says now. */
async function freshRead(loaded: Loaded) {
  const result = await syncPullRequestStatus(loaded.bug.id, { actorUserId: loaded.user.id });
  if (!result.ok) throw new GitHubError(409, result.message);
  const ref = parsePullRequestUrl(result.status.pullRequestUrl);
  if (!ref) throw new GitHubError(409, "The linked pull request isn't a GitHub pull request address.");
  const client = await githubClientFor(loaded.bug.project);
  if (!client.canWrite) {
    throw new GitHubError(401, "Ziki can read this repository but can't change it. Connect the project's GitHub App (project settings), or set GITHUB_TOKEN.");
  }
  return { status: result.status, ref, client };
}

async function note(loaded: Loaded, body: string) {
  const data = new FormData();
  data.set("body", body);
  await addCommentAction(loaded.bug.id, data);
}

/** GitHub's "Update branch": bring the base branch into the pull request branch. */
export async function updatePullRequestBranchAction(bugId: string): Promise<GitHubActionResult> {
  const loaded = await guard(bugId, "act");
  if (isResult(loaded)) return loaded;
  try {
    const { status, ref, client } = await freshRead(loaded);
    if (!status.diagnosis.blockers.some((blocker) => blocker.actions.includes("update_branch"))) {
      return { ok: false, error: "The branch doesn't need updating (or has conflicts the fixer must resolve)." };
    }
    await updateBranch(client, ref, status.snapshot.headSha!);
    await syncPullRequestStatus(loaded.bug.id, { actorUserId: loaded.user.id });
    await note(loaded, `Updated the pull request branch with ${status.snapshot.baseRef ?? "its base branch"} from Ziki. The checks run again on the new commit.`);
    refresh();
    return { ok: true, message: "GitHub is updating the branch. The checks will run again; Ziki picks up the result." };
  } catch (error) {
    return failure(error);
  }
}

/** Re-run the failed GitHub Actions jobs on the head commit. */
export async function rerunFailedChecksAction(bugId: string): Promise<GitHubActionResult> {
  const loaded = await guard(bugId, "act");
  if (isResult(loaded)) return loaded;
  try {
    const { status, ref, client } = await freshRead(loaded);
    const restarted = await rerunFailedChecks(client, ref, status.snapshot);
    await syncPullRequestStatus(loaded.bug.id, { actorUserId: loaded.user.id });
    refresh();
    return { ok: true, message: `Re-running ${restarted} failed ${restarted === 1 ? "run" : "runs"}. If it fails again, send it back to the fixer.` };
  } catch (error) {
    return failure(error);
  }
}

/** Merge it on GitHub, when nothing is in the way. The issue goes Live once a manager agent resolves it. */
export async function mergePullRequestAction(bugId: string): Promise<GitHubActionResult> {
  const loaded = await guard(bugId, "merge");
  if (isResult(loaded)) return loaded;
  if (loaded.bug.status !== "merge") return { ok: false, error: "Only an issue in Merge can be merged from Ziki: it needs a manager's accept first." };
  try {
    const { status, ref, client } = await freshRead(loaded);
    if (!status.diagnosis.canMerge || !status.snapshot.headSha) return { ok: false, error: status.diagnosis.headline };
    const merged = await mergePullRequest(client, ref, { headSha: status.snapshot.headSha, title: status.snapshot.title, issueNumber: loaded.bug.number });
    await syncPullRequestStatus(loaded.bug.id, { actorUserId: loaded.user.id });
    await note(loaded, `Merged pull request #${ref.number} on GitHub from Ziki (${merged.method}, ${merged.sha.slice(0, 7)}). A manager agent resolves it to make it Live and pay the points.`);
    refresh();
    return { ok: true, message: `Merged (${merged.method}). A manager agent resolves it next.` };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Send the fix back to its fixer: the issue goes back to In progress, the
 * note (drafted from GitHub's blockers, edited by the person) goes on the
 * issue, and the person the fix is for is told. The agent holding the claim
 * sees the move and the comment in its events and work feed, like a manager's
 * reject.
 */
export async function sendBackToFixerAction(bugId: string, rawNote: string): Promise<GitHubActionResult> {
  const loaded = await guard(bugId, "act");
  if (isResult(loaded)) return loaded;
  const { bug, user } = loaded;
  const text = typeof rawNote === "string" ? rawNote.trim().slice(0, NOTE_MAX_CHARS) : "";
  if (text.length < 10) return { ok: false, error: "Say what the fixer has to change." };
  if (!(SEND_BACK_STATUSES as readonly string[]).includes(bug.status)) {
    return { ok: false, error: "Only a delivered fix (Done or Merge) can be sent back." };
  }
  if (!bug.pullRequestUrl) return { ok: false, error: "This issue has no linked pull request." };
  const claim = bug.claims[0] ?? null;
  const summary = text.split("\n").find((line) => line.trim())?.trim().slice(0, 200) ?? "GitHub can't merge it yet.";

  const moved = await prisma.$transaction(async (tx) => {
    const result = await tx.bug.updateMany({
      where: { id: bug.id, status: { in: [...SEND_BACK_STATUSES] }, isDeleted: false },
      data: moveTo("in_progress"),
    });
    if (!result.count) return false;
    await tx.bugActivity.create({
      data: {
        bugId: bug.id,
        actorId: user.id,
        type: "status_changed",
        summary: `${statusChangedSummary(bug.substatus, "in_progress")}: sent back to the fixer (${summary})`,
        metadata: { field: "status", from: bug.substatus, to: "in_progress", via: "github_send_back", note: text, pullRequestUrl: bug.pullRequestUrl },
      },
    });
    await publish(tx, {
      tenantId: bug.tenantId,
      type: "issue.updated",
      payload: {
        issueId: bug.id,
        ...moveTo("in_progress"),
        sentBack: true,
        via: "github_status",
        byUserId: user.id,
        summary,
        notes: text,
        pullRequestUrl: bug.pullRequestUrl,
        claimAgentId: claim?.agentId ?? null,
      },
      actorAgentId: null,
      bugId: bug.id,
    });
    return true;
  });
  if (!moved) return { ok: false, error: "The issue moved on before this was sent. Reload and look again." };

  await note(loaded, `**Sent back to the fixer from the GitHub status.**\n\n${text}`);
  notifyAuthor({
    bug: { id: bug.id, title: bug.title },
    recipientId: claim?.beneficiaryUserId ?? bug.beneficiaryUserId,
    reason: summary,
    fromAgentName: user.name ?? "A reviewer",
  });
  refresh();
  return { ok: true, message: claim?.agent ? `Sent back to ${claim.agent.name}. It's In progress again.` : "Sent back. It's In progress again." };
}
