import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { audit } from "@/lib/agents/audit";
import { expireUnreadCounts } from "@/lib/cache-tags";
import { MANAGE_AGENTS_HREF } from "@/lib/header-nav";
import { issueHref } from "@/lib/issue-ref";
import { ideaPath, refOf } from "@/lib/project-paths";
import {
  findSecretsInFields,
  secretBlockedMessage,
  SECRET_KINDS,
  type FieldSecretMatch,
  type SecretKind,
  type SecretMatch,
} from "@/lib/security/secrets";

/**
 * Push protection (#secret-protection): every post a person or agent makes
 * passes through here before it is saved. A post with a credential in it is
 * stopped, the sender is told what and where (never the secret), and the
 * organisation's Secret alerts page records it.
 *
 * Ziki's own agent keys get one more step, because Ziki can tell a working
 * key from a dead one: a working key in someone else's hands is revoked on
 * the spot, and its owner is told how to get a new one.
 */

/** Who is posting: a person, or an agent acting for its owner. */
export type SecretActor =
  | { kind: "user"; userId: string }
  | { kind: "agent"; agentId: string; agentName: string; ownerId: string };

export type SecretPost = {
  /** Where the alert is filed. Without one the post is still stopped, just not recorded. */
  organisationId: string | null;
  projectId?: string | null;
  actor: SecretActor;
  /** "idea", "issue", "comment", "upload", or the agent route's action ("comments.create"). */
  source: string;
  /** The page of the post it was headed for, when there is one already. */
  url?: string | null;
  bugId?: string | null;
  ideaId?: string | null;
  commentId?: string | null;
  fields: Record<string, string | null | undefined> | ReadonlyArray<{ field: string; text: string }>;
  /** What the post is called in the message: "this comment". */
  noun?: string;
};

/** One secret as its sender is told about it. Never the secret. */
export type SecretFindingView = { field: string; line: number; kind: SecretKind; label: string; preview: string };

export type SecretCheck =
  | { ok: true }
  | { ok: false; message: string; field: string; secrets: SecretFindingView[] };

/** Repeats of the same secret by the same sender within this long count on one alert. */
const SAME_ATTEMPT_MS = 24 * 60 * 60 * 1000;

export function findingView(match: FieldSecretMatch): SecretFindingView {
  return { field: match.field, line: match.line, kind: match.kind, label: SECRET_KINDS[match.kind].label, preview: match.preview };
}

/**
 * Checks a post's fields. `{ ok: true }` when there is nothing in them;
 * otherwise the post must not be saved, and `message` says why.
 */
export async function checkPostForSecrets(post: SecretPost): Promise<SecretCheck> {
  const found = findSecretsInFields(post.fields);
  if (found.length === 0) return { ok: true };
  // The post is stopped whatever happens next: recording it is best effort.
  try {
    await recordBlocked(post, found);
  } catch (error) {
    logger.error("[secret-protection] could not record a stopped post", { source: post.source, organisationId: post.organisationId }, error);
  }
  return {
    ok: false,
    message: secretBlockedMessage(found, post.noun ?? "this"),
    field: found[0].field,
    secrets: found.map(findingView),
  };
}

/** The page of the issue or idea a post belongs to, so the alert can link to it. */
export async function postUrl(where: { bugId?: string | null; ideaId?: string | null }): Promise<string | null> {
  const project = { select: { slug: true, organisation: { select: { slug: true } } } } as const;
  if (where.bugId) {
    const bug = await prisma.bug.findUnique({ where: { id: where.bugId }, select: { number: true, project } });
    return bug ? issueHref(bug) : null;
  }
  if (where.ideaId) {
    const idea = await prisma.idea.findUnique({ where: { id: where.ideaId }, select: { number: true, project } });
    return idea ? ideaPath(refOf(idea.project), idea.number) : null;
  }
  return null;
}

/** One alert per secret: a repeat of the same one by the same sender only counts another attempt. */
async function recordBlocked(post: SecretPost, found: readonly FieldSecretMatch[]): Promise<void> {
  if (!post.organisationId) return;
  const organisationId = post.organisationId;
  const now = new Date();
  if (post.url === undefined) post = { ...post, url: await postUrl(post) };
  const actorUserId = post.actor.kind === "user" ? post.actor.userId : null;
  const actorAgentId = post.actor.kind === "agent" ? post.actor.agentId : null;
  const seen = new Set<string>();
  for (const match of found) {
    if (seen.has(match.fingerprint)) continue;
    seen.add(match.fingerprint);

    const key = match.kind === "ziki_agent_key" ? await liveZikiKey(match) : null;
    // Someone else's working agent key, in this sender's hands: it has leaked
    // already, whether or not this post goes up. Turn it off now.
    const revoke = key && !isOwnKey(post.actor, key);

    const repeat = await prisma.secretAlert.findFirst({
      where: {
        organisationId,
        fingerprint: match.fingerprint,
        state: "blocked",
        source: post.source,
        actorUserId,
        actorAgentId,
        lastSeenAt: { gte: new Date(now.getTime() - SAME_ATTEMPT_MS) },
      },
      select: { id: true },
    });
    if (repeat) {
      await prisma.secretAlert.update({
        where: { id: repeat.id },
        data: { attempts: { increment: 1 }, lastSeenAt: now },
      });
      continue;
    }

    // Always `blocked`: the post never went up, so there is nothing in it to
    // remove. `agentApiKeyId` is set only when Ziki turned that key off.
    await prisma.secretAlert.create({
      data: {
        organisationId,
        projectId: post.projectId ?? null,
        kind: match.kind,
        fingerprint: match.fingerprint,
        preview: match.preview,
        state: "blocked",
        source: post.source,
        url: post.url ?? null,
        bugId: post.bugId ?? null,
        ideaId: post.ideaId ?? null,
        commentId: post.commentId ?? null,
        field: match.field,
        line: match.line,
        actorUserId,
        actorAgentId,
        agentApiKeyId: revoke ? key.id : null,
      },
    });

    if (key && revoke) {
      await revokeLeakedKey(key, { organisationId, reason: "posted_by_someone_else", url: post.url ?? null, now });
    } else if (key && post.actor.kind === "agent") {
      // An agent tried to post its own key. Nothing went up, but the key is
      // somewhere in what the agent works with: its owner should know.
      await notifyOwner(key.agent.ownerUserId, organisationId, {
        kind: "secret_blocked",
        title: `Ziki stopped ${key.agent.name} from posting its own agent key. Nothing was posted; if it printed the key anywhere else, get a new one.`,
        url: `/agent/${encodeURIComponent(key.agent.username)}/edit/key`,
      });
    } else if (post.actor.kind === "agent") {
      await notifyOwner(post.actor.ownerId, organisationId, {
        kind: "secret_blocked",
        title: `Ziki stopped ${post.actor.agentName} from posting ${articled(SECRET_KINDS[match.kind].label)} (${match.preview}). Nothing was posted.`,
        url: post.url ?? MANAGE_AGENTS_HREF,
      });
    }
  }
}

export type LiveZikiKey = {
  id: string;
  organisationId: string;
  prefix: string;
  agent: { id: string; name: string; username: string; ownerUserId: string };
};

/** The working Ziki agent key a match is, if it is one. */
export async function liveZikiKey(match: Pick<SecretMatch, "zikiKeyHash">): Promise<LiveZikiKey | null> {
  if (!match.zikiKeyHash) return null;
  const key = await prisma.agentApiKey.findUnique({
    where: { keyHash: match.zikiKeyHash },
    select: {
      id: true,
      organisationId: true,
      prefix: true,
      revokedAt: true,
      agent: { select: { id: true, name: true, username: true, ownerUserId: true, revokedAt: true } },
    },
  });
  if (!key || key.revokedAt || key.agent.revokedAt) return null;
  return { id: key.id, organisationId: key.organisationId, prefix: key.prefix, agent: key.agent };
}

/** The key's own agent, its owner, or another agent of the same owner. */
function isOwnKey(actor: SecretActor, key: LiveZikiKey): boolean {
  if (actor.kind === "user") return actor.userId === key.agent.ownerUserId;
  return actor.agentId === key.agent.id || actor.ownerId === key.agent.ownerUserId;
}

/**
 * Turns a leaked agent key off. The agent and everything it did stay; only
 * this key stops working, and the owner is told where to get a new one.
 * Returns false when the key was already off.
 */
export async function revokeLeakedKey(
  key: LiveZikiKey,
  context: { organisationId: string; reason: "posted_by_someone_else" | "found_in_post"; url: string | null; actorUserId?: string | null; now?: Date },
): Promise<boolean> {
  const now = context.now ?? new Date();
  const revoked = await prisma.agentApiKey.updateMany({
    where: { id: key.id, revokedAt: null },
    data: { revokedAt: now },
  });
  if (revoked.count === 0) return false;
  try {
    await audit(
      { agentId: key.agent.id, organisationId: key.organisationId },
      "agent.key_revoked_leaked",
      `agent:${key.agent.id}`,
      { prefix: key.prefix, reason: context.reason, foundIn: context.organisationId },
      { actorUserId: context.actorUserId ?? null },
    );
  } catch (error) {
    logger.error("[secret-protection] could not audit a leaked key's revocation", { keyId: key.id }, error);
  }
  await notifyOwner(key.agent.ownerUserId, key.organisationId, {
    kind: "agent_key_revoked",
    title: `Ziki turned off ${key.agent.name}'s key (${key.prefix}…) because it was found in a post. Get a new key to keep it working.`,
    url: `/agent/${encodeURIComponent(key.agent.username)}/edit/key`,
  });
  return true;
}

async function notifyOwner(userId: string, organisationId: string | null, notice: { kind: string; title: string; url: string }) {
  try {
    await prisma.notification.create({
      data: { userId, organisationId, kind: notice.kind, title: notice.title.slice(0, 300), url: notice.url },
    });
    expireUnreadCounts([userId]);
  } catch (error) {
    logger.error("[secret-protection] could not notify an owner", { kind: notice.kind }, error);
  }
}

function articled(label: string): string {
  return `${/^[aeiou]/i.test(label) ? "an" : "a"} ${label}`;
}

/**
 * Every string in an agent's JSON body, named by where it is ("description",
 * "receipt.verified", "screenshots[0]"), so a secret anywhere in it is found.
 * Bounded, so a huge body can't make the check expensive.
 */
export function stringsIn(value: unknown, limit = { strings: 400, chars: 1_000_000 }): Array<{ field: string; text: string }> {
  const out: Array<{ field: string; text: string }> = [];
  let chars = 0;
  const walk = (node: unknown, path: string, depth: number) => {
    if (out.length >= limit.strings || chars >= limit.chars || depth > 8) return;
    if (typeof node === "string") {
      const text = node.slice(0, limit.chars - chars);
      chars += text.length;
      out.push({ field: path || "body", text });
    } else if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1));
    } else if (node && typeof node === "object") {
      for (const [key, item] of Object.entries(node as Record<string, unknown>)) {
        walk(item, path ? `${path}.${key}` : key, depth + 1);
      }
    }
  };
  walk(value, "", 0);
  return out;
}
