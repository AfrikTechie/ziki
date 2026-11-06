import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/** The list's status token and path segment (lib/project-paths.ts). */
export const POSSIBLY_DELIVERED_STATUS = "possibly_delivered";

/** Words in a comment that say the work was merged or shipped. */
const MERGE_WORDS = ["merged", "/pull/", "/commit/", "shipped", "deployed", "already implemented"];

/**
 * Open issues that may already be done (#possibly-delivered): a linked pull
 * request, a pull request report, a delivery, or a comment that names a pull
 * request or commit or says it was merged. They stay Open until someone looks;
 * this list puts them in front of a manager. A comment is only a hint.
 */
export const POSSIBLY_DELIVERED_WHERE: Prisma.BugWhereInput = {
  status: "open",
  OR: [
    { pullRequestUrl: { not: null } },
    { pullRequestReports: { some: {} } },
    { deliveries: { some: {} } },
    { comments: { some: { deletedAt: null, OR: MERGE_WORDS.map((word) => ({ body: { contains: word, mode: "insensitive" as const } })) } } },
  ],
};

export type DeliverySignals = {
  /** Why it is on the list, e.g. "PR #12 reported merged". */
  reasons: string[];
  /** The pull request or commit links found, for the evidence. */
  links: string[];
  /** The last meaningful activity: a comment, report, delivery or claim. */
  lastActivityAt: Date | null;
  /** Why it is still Open, e.g. "Awaiting confirmation". */
  stillOpenBecause: string;
};

const LINK = /https:\/\/github\.com\/[^\s)"'<>]+\/(?:pull\/\d+|commit\/[0-9a-f]{7,40})/gi;

/** The signals for each listed issue, by id. */
export async function deliverySignals(db: Db, bugIds: string[]): Promise<Map<string, DeliverySignals>> {
  if (bugIds.length === 0) return new Map();
  const bugs = await db.bug.findMany({
    where: { id: { in: bugIds } },
    select: {
      id: true,
      substatus: true,
      pullRequestUrl: true,
      updatedAt: true,
      pullRequestReports: { orderBy: { createdAt: "desc" }, take: 1, select: { state: true, pullRequestUrl: true, createdAt: true } },
      deliveries: { orderBy: { createdAt: "desc" }, take: 1, select: { pullRequestUrl: true, createdAt: true } },
      comments: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { body: true, createdAt: true },
      },
      claims: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, createdAt: true } },
      _count: { select: { bids: true } },
    },
  });
  const result = new Map<string, DeliverySignals>();
  for (const bug of bugs) {
    const reasons: string[] = [];
    const links = new Set<string>();
    const report = bug.pullRequestReports[0];
    if (report) {
      reasons.push(`Pull request reported ${report.state === "not_found" ? "not found" : report.state}`);
      links.add(report.pullRequestUrl);
    }
    if (bug.pullRequestUrl) {
      if (!report) reasons.push("A pull request is linked");
      links.add(bug.pullRequestUrl);
    }
    const delivery = bug.deliveries[0];
    if (delivery) {
      reasons.push("Work was delivered before");
      if (delivery.pullRequestUrl) links.add(delivery.pullRequestUrl);
    }
    const mentioning = bug.comments.find((c) => MERGE_WORDS.some((word) => c.body.toLowerCase().includes(word)));
    if (mentioning) {
      reasons.push("A comment mentions a merge or a pull request");
      for (const match of mentioning.body.match(LINK) ?? []) links.add(match);
    }
    const dates = [report?.createdAt, delivery?.createdAt, bug.comments[0]?.createdAt, bug.claims[0]?.createdAt].filter((d): d is Date => Boolean(d));
    const lastActivityAt = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
    const stillOpenBecause =
      bug.substatus === "requires_confirmation"
        ? "Awaiting confirmation"
        : bug._count.bids === 0
          ? "No bids: nobody took it on"
          : "Bids, but none awarded";
    result.set(bug.id, { reasons, links: [...links], lastActivityAt, stillOpenBecause });
  }
  return result;
}
