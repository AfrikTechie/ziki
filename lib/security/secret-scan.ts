import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { commentedSummary, commentPreview } from "@/lib/activity-log";
import { issueHref, issuePath } from "@/lib/issue-ref";
import { ideaPath, refOf } from "@/lib/project-paths";
import { findSecretsInFields, redactSecrets, type FieldSecretMatch } from "@/lib/security/secrets";
import { liveZikiKey, revokeLeakedKey } from "@/lib/security/secret-guard";

/**
 * Finding secrets that are already up (#secret-protection). Push protection
 * stops new ones; this reads what an organisation posted before it, or what
 * got past it: ideas, issues and every earlier version of them, comments, and
 * private security reports, whose text goes public once their fix is live.
 *
 * A working Ziki agent key found in a post is revoked at once. Anything else
 * becomes an `exposed` alert for an admin: the owner of the credential has to
 * turn it off where it was made, and the admin can remove it from the post.
 */

/** The order a scan reads posts in. A cursor is a phase and the last id read in it. */
const PHASES = ["ideas", "issues", "history", "comments", "findings"] as const;
type Phase = (typeof PHASES)[number];

export type ScanProgress = {
  /** Posts read in this run. */
  scanned: number;
  /** New alerts this run filed. */
  found: number;
  /** Ziki agent keys this run turned off. */
  revokedKeys: number;
  /** Where to carry on from, or null when every post has been read. */
  next: string | null;
};

type Post = {
  bugId?: string;
  ideaId?: string;
  commentId?: string;
  findingId?: string;
  projectId: string;
  source: "idea" | "issue" | "issue_history" | "comment" | "finding";
  url: string | null;
  actorUserId: string | null;
  actorAgentId: string | null;
  fields: Record<string, string | null | undefined>;
};

const PROJECT = { select: { slug: true, organisation: { select: { slug: true } } } } as const;

/**
 * Reads up to `maxRows` posts from `cursor` on (from the start without one)
 * and files an alert for each secret not already on the page.
 */
export async function scanOrganisationPosts(
  organisationId: string,
  actorUserId: string,
  cursor: string | null,
  options: { maxRows?: number; batch?: number; deadlineMs?: number } = {},
): Promise<ScanProgress> {
  const maxRows = options.maxRows ?? 5000;
  const batch = options.batch ?? 250;
  const deadline = Date.now() + (options.deadlineMs ?? 20_000);
  let { phase, after } = parseCursor(cursor);
  const progress: ScanProgress = { scanned: 0, found: 0, revokedKeys: 0, next: null };

  while (phase) {
    if (progress.scanned >= maxRows || Date.now() > deadline) {
      progress.next = `${phase}:${after ?? ""}`;
      return progress;
    }
    const posts = await readPosts(organisationId, phase, after, batch);
    for (const { post, id } of posts) {
      after = id;
      progress.scanned += 1;
      const found = findSecretsInFields(post.fields);
      if (found.length === 0) continue;
      const filed = await fileExposed(organisationId, actorUserId, post, found);
      progress.found += filed.found;
      progress.revokedKeys += filed.revoked;
    }
    if (posts.length < batch) {
      const index = PHASES.indexOf(phase);
      phase = PHASES[index + 1];
      after = null;
    }
  }
  return progress;
}

function parseCursor(cursor: string | null): { phase: Phase | undefined; after: string | null } {
  if (!cursor) return { phase: PHASES[0], after: null };
  const [name, id] = cursor.split(":");
  const phase = PHASES.find((p) => p === name);
  return phase ? { phase, after: id || null } : { phase: PHASES[0], after: null };
}

async function readPosts(organisationId: string, phase: Phase, after: string | null, take: number): Promise<Array<{ id: string; post: Post }>> {
  const page = { take, orderBy: { id: "asc" as const }, ...(after ? { cursor: { id: after }, skip: 1 } : {}) };
  if (phase === "ideas") {
    const rows = await prisma.idea.findMany({
      ...page,
      where: { organisationId, isDeleted: false },
      select: { id: true, number: true, title: true, summary: true, description: true, rationale: true, projectId: true, reporterId: true, createdByAgentId: true, project: PROJECT },
    });
    return rows.map((row) => ({
      id: row.id,
      post: {
        ideaId: row.id,
        projectId: row.projectId,
        source: "idea",
        url: ideaPath(refOf(row.project), row.number),
        actorUserId: row.createdByAgentId ? null : row.reporterId,
        actorAgentId: row.createdByAgentId,
        fields: { title: row.title, summary: row.summary, description: row.description, rationale: row.rationale },
      },
    }));
  }
  if (phase === "issues") {
    const rows = await prisma.bug.findMany({
      ...page,
      where: { organisationId, isDeleted: false },
      select: { id: true, number: true, title: true, description: true, projectId: true, reporterId: true, createdByAgentId: true, project: PROJECT },
    });
    return rows.map((row) => ({
      id: row.id,
      post: {
        bugId: row.id,
        projectId: row.projectId,
        source: "issue",
        url: issueHref(row),
        actorUserId: row.createdByAgentId ? null : row.reporterId,
        actorAgentId: row.createdByAgentId,
        fields: { title: row.title, description: row.description },
      },
    }));
  }
  if (phase === "history") {
    const rows = await prisma.bugRevision.findMany({
      ...page,
      where: { bug: { organisationId, isDeleted: false } },
      select: { id: true, title: true, description: true, editedById: true, bugId: true, bug: { select: { number: true, projectId: true, project: PROJECT } } },
    });
    return rows.map((row) => ({
      id: row.id,
      post: {
        bugId: row.bugId,
        projectId: row.bug.projectId,
        source: "issue_history",
        url: issueHref(row.bug, "/history"),
        actorUserId: row.editedById,
        actorAgentId: null,
        fields: { title: row.title, description: row.description },
      },
    }));
  }
  if (phase === "findings") {
    // Disclosed reports are already on their idea and issue, read above.
    const rows = await prisma.securityFinding.findMany({
      ...page,
      where: { organisationId, disclosedAt: null },
      select: { id: true, title: true, summary: true, description: true, projectId: true, reporterId: true, project: PROJECT, idea: { select: { number: true } }, bug: { select: { number: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      post: {
        // Only the report itself: its idea and issue hold placeholders until it is disclosed.
        findingId: row.id,
        projectId: row.projectId,
        source: "finding",
        url: row.bug ? issuePath(refOf(row.project), row.bug.number) : row.idea ? ideaPath(refOf(row.project), row.idea.number) : null,
        actorUserId: row.reporterId,
        actorAgentId: null,
        fields: { title: row.title, summary: row.summary, description: row.description },
      },
    }));
  }
  const rows = await prisma.comment.findMany({
    ...page,
    where: { deletedAt: null, bug: { organisationId, isDeleted: false } },
    select: { id: true, body: true, summary: true, authorId: true, agentId: true, bugId: true, bug: { select: { number: true, projectId: true, project: PROJECT } } },
  });
  return rows.map((row) => ({
    id: row.id,
    post: {
      bugId: row.bugId,
      commentId: row.id,
      projectId: row.bug.projectId,
      source: "comment",
      url: issueHref(row.bug, `#comment-${row.id}`),
      actorUserId: row.agentId ? null : row.authorId,
      actorAgentId: row.agentId,
      fields: { summary: row.summary, body: row.body },
    },
  }));
}

/** Files one alert per secret per post, unless the page already has it; revokes working Ziki keys. */
async function fileExposed(
  organisationId: string,
  actorUserId: string,
  post: Post,
  found: readonly FieldSecretMatch[],
): Promise<{ found: number; revoked: number }> {
  let filed = 0;
  let revoked = 0;
  const seen = new Set<string>();
  for (const match of found) {
    if (seen.has(match.fingerprint)) continue;
    seen.add(match.fingerprint);
    try {
      const already = await prisma.secretAlert.findFirst({
        where: {
          organisationId,
          fingerprint: match.fingerprint,
          source: post.source,
          bugId: post.bugId ?? null,
          ideaId: post.ideaId ?? null,
          commentId: post.commentId ?? null,
          findingId: post.findingId ?? null,
          // A post stopped while being edited is not the saved post.
          state: { not: "blocked" },
        },
        select: { id: true },
      });
      if (already) continue;

      const now = new Date();
      const key = match.kind === "ziki_agent_key" ? await liveZikiKey(match) : null;
      // An agent key that is already off can't be used: nothing to do.
      if (match.kind === "ziki_agent_key" && !key) continue;
      const turnedOff = key
        ? await revokeLeakedKey(key, { organisationId, reason: "found_in_post", url: post.url, actorUserId, now })
        : false;
      if (turnedOff) revoked += 1;

      await prisma.secretAlert.create({
        data: {
          organisationId,
          projectId: post.projectId,
          kind: match.kind,
          fingerprint: match.fingerprint,
          preview: match.preview,
          state: key ? "revoked" : "exposed",
          source: post.source,
          url: post.url,
          bugId: post.bugId ?? null,
          ideaId: post.ideaId ?? null,
          commentId: post.commentId ?? null,
          findingId: post.findingId ?? null,
          field: match.field,
          line: match.line,
          actorUserId: post.actorUserId,
          actorAgentId: post.actorAgentId,
          agentApiKeyId: key?.id ?? null,
          ...(key ? { resolvedAt: now } : {}),
        },
      });
      filed += 1;
    } catch (error) {
      logger.error("[secret-protection] could not file an alert from a scan", { organisationId, source: post.source }, error);
    }
  }
  return { found: filed, revoked };
}

export type RedactResult = { ok: true; removed: number } | { ok: false; error: string };

/**
 * Removes one alert's secret from the post it is in, and from every earlier
 * version Ziki keeps of it, replacing it with a note saying what was there.
 * Only text that still holds that exact secret changes.
 */
export async function redactAlert(organisationId: string, alertId: string, actorUserId: string): Promise<RedactResult> {
  const alert = await prisma.secretAlert.findFirst({
    where: { id: alertId, organisationId },
    select: { id: true, state: true, fingerprint: true, bugId: true, ideaId: true, commentId: true, findingId: true },
  });
  if (!alert) return { ok: false, error: "That alert isn't in this organisation." };
  // A stopped post was never saved: the issue it was headed for doesn't hold the secret.
  if (alert.state === "blocked" || (!alert.bugId && !alert.ideaId && !alert.commentId && !alert.findingId)) {
    return { ok: false, error: "That secret was stopped before it was posted, so there is nothing to remove." };
  }
  const only = new Set([alert.fingerprint]);
  const clean = (text: string | null | undefined) => (text ? redactSecrets(text, only) : { text: text ?? null, removed: 0 });

  const removed = await prisma.$transaction(async (tx) => {
    let count = 0;
    if (alert.findingId) {
      const finding = await tx.securityFinding.findFirst({
        where: { id: alert.findingId, organisationId },
        select: { id: true, title: true, summary: true, description: true },
      });
      if (finding) {
        const parts = { title: clean(finding.title), summary: clean(finding.summary), description: clean(finding.description) };
        const total = parts.title.removed + parts.summary.removed + parts.description.removed;
        if (total) {
          await tx.securityFinding.update({
            where: { id: finding.id },
            data: { title: parts.title.text ?? finding.title, summary: parts.summary.text, description: parts.description.text ?? finding.description },
          });
          count += total;
        }
      }
    } else if (alert.commentId) {
      const comment = await tx.comment.findFirst({
        where: { id: alert.commentId, bug: { organisationId } },
        select: { id: true, bugId: true, body: true, summary: true },
      });
      if (comment) {
        const body = clean(comment.body);
        const summary = clean(comment.summary);
        if (body.removed || summary.removed) {
          await tx.comment.update({ where: { id: comment.id }, data: { body: body.text ?? comment.body, summary: summary.text } });
          // The activity feed keeps a preview of the comment's opening words.
          await tx.bugActivity.updateMany({
            where: { bugId: comment.bugId, type: "commented", metadata: { path: ["commentId"], equals: comment.id } },
            data: {
              summary: commentedSummary(body.text ?? comment.body),
              metadata: { field: "comment", commentId: comment.id, commentPreview: commentPreview(body.text ?? comment.body) } as Prisma.InputJsonValue,
            },
          });
          count += body.removed + summary.removed;
        }
      }
    } else if (alert.ideaId) {
      const idea = await tx.idea.findFirst({
        where: { id: alert.ideaId, organisationId },
        select: { id: true, title: true, summary: true, description: true, rationale: true },
      });
      if (idea) {
        const parts = { title: clean(idea.title), summary: clean(idea.summary), description: clean(idea.description), rationale: clean(idea.rationale) };
        const total = parts.title.removed + parts.summary.removed + parts.description.removed + parts.rationale.removed;
        if (total) {
          await tx.idea.update({
            where: { id: idea.id },
            data: { title: parts.title.text ?? idea.title, summary: parts.summary.text, description: parts.description.text ?? idea.description, rationale: parts.rationale.text },
          });
          count += total;
        }
      }
    }
    if (alert.bugId && !alert.commentId) {
      const bug = await tx.bug.findFirst({ where: { id: alert.bugId, organisationId }, select: { id: true, title: true, description: true } });
      if (bug) {
        const title = clean(bug.title);
        const description = clean(bug.description);
        if (title.removed || description.removed) {
          await tx.bug.update({ where: { id: bug.id }, data: { title: title.text ?? bug.title, description: description.text ?? bug.description } });
          count += title.removed + description.removed;
        }
        // Every earlier version shown on the issue's history page.
        const revisions = await tx.bugRevision.findMany({ where: { bugId: bug.id }, select: { id: true, title: true, description: true } });
        for (const revision of revisions) {
          const oldTitle = clean(revision.title);
          const oldDescription = clean(revision.description);
          if (!oldTitle.removed && !oldDescription.removed) continue;
          await tx.bugRevision.update({
            where: { id: revision.id },
            data: { title: oldTitle.text ?? revision.title, description: oldDescription.text ?? revision.description },
          });
          count += oldTitle.removed + oldDescription.removed;
        }
      }
    }
    // Every alert for this secret in this post is dealt with at once.
    await tx.secretAlert.updateMany({
      where: {
        organisationId,
        fingerprint: alert.fingerprint,
        bugId: alert.bugId,
        ideaId: alert.ideaId,
        commentId: alert.commentId,
        findingId: alert.findingId,
        state: { in: ["exposed", "revoked"] },
      },
      data: { state: "redacted", resolvedAt: new Date(), resolvedByUserId: actorUserId },
    });
    return count;
  });
  return { ok: true, removed };
}

/** Marks an alert dealt with by hand: the owner turned the secret off, or it was never a real one. */
export async function resolveAlert(
  organisationId: string,
  alertId: string,
  actorUserId: string,
  state: "revoked" | "dismissed",
): Promise<boolean> {
  const updated = await prisma.secretAlert.updateMany({
    where: { id: alertId, organisationId, state: { in: ["exposed", "blocked"] } },
    data: { state, resolvedAt: new Date(), resolvedByUserId: actorUserId },
  });
  return updated.count === 1;
}
