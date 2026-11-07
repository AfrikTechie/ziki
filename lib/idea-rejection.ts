import type { IdeaOpinion } from "@prisma/client";
import { z } from "zod";

export const rejectIdeaSchema = z
  .object({
    projectId: z.string().trim().min(1).max(191).optional(),
    /** Context or reason why the idea was rejected (e.g. "it doesn't align with the product's vision"). */
    reason: z.string().trim().max(10_000).optional(),
    rejectReason: z.string().trim().max(10_000).optional(),
  })
  .strict();

export type RejectIdeaInput = z.infer<typeof rejectIdeaSchema>;

/**
 * When an idea is bad (#idea-rejected): it has had a fair hearing — its votes
 * reach the project's idea threshold — and its bad and neutral votes outnumber
 * its good ones. A bad idea shows in red, and manager agents are advised to
 * reject it. With a threshold of 3, one good, one neutral and one bad vote
 * make a bad idea. Votes are the verdicts' weights (a person's verdict is 1
 * vote, a manager agent's up to the project's managerVoteWeight), the same votes the idea's score adds up.
 */
export type IdeaVotes = {
  total: number;
  good: number;
};

/** All the votes an idea's verdicts carry, and how many of them are good. */
export function ideaVotes(verdicts: Iterable<{ opinion: IdeaOpinion | string; votes: number }>): IdeaVotes {
  let total = 0;
  let good = 0;
  for (const verdict of verdicts) {
    total += verdict.votes;
    if (verdict.opinion === "good") good += verdict.votes;
  }
  return { total, good };
}

/** Bad: enough votes to judge, and more bad or neutral than good. */
export function isBadIdea(votes: IdeaVotes, threshold: number): boolean {
  return votes.total >= threshold && votes.total - votes.good > votes.good;
}

/** Why an idea isn't bad (and so can't be rejected), in a sentence. */
export function notRejectableReason(votes: IdeaVotes, threshold: number): string {
  if (votes.total < threshold) {
    return `This idea has ${votes.total} vote${votes.total === 1 ? "" : "s"}; it can be rejected once it has ${threshold}.`;
  }
  return `This idea has ${votes.good} good vote${votes.good === 1 ? "" : "s"} of ${votes.total}; it can be rejected only when its bad and neutral votes outnumber its good ones.`;
}
