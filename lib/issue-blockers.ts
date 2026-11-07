import type { Status, Substatus } from "@prisma/client";

export type BlockerState = { status: Status; substatus: Substatus };

/** Walk existing prerequisite edges to prevent an issue from depending on itself indirectly. */
export async function wouldCreateBlockerCycle(
  blockedId: string,
  blockerId: string,
  blockersFor: (issueIds: string[]) => Promise<string[]>,
): Promise<boolean> {
  const visited = new Set<string>();
  let frontier = [blockerId];
  while (frontier.length) {
    if (frontier.includes(blockedId)) return true;
    const unseen = frontier.filter((id) => !visited.has(id));
    if (!unseen.length) return false;
    unseen.forEach((id) => visited.add(id));
    frontier = await blockersFor(unseen);
  }
  return false;
}

/** A plain-language explanation of the dependency's effect and the next useful action. */
export function blockerGuidance(blocker: BlockerState): { meaning: string; nextStep: string } {
  if (blocker.status === "resolved") {
    return {
      meaning: "The blocking issue is live, so this dependency may already be cleared.",
      nextStep: "Check the work, then remove this blocker link if the issue can proceed.",
    };
  }
  if (blocker.status === "closed") {
    return {
      meaning: "The blocking issue was stopped without shipping, so the dependency may no longer be achievable.",
      nextStep: "Confirm the dependency is still valid; choose a replacement blocker or remove this link if it is not.",
    };
  }
  if (blocker.substatus === "error") {
    return {
      meaning: "Its pull request cannot merge yet, so work that depends on it is still waiting.",
      nextStep: "Open the blocking issue, follow its merge error, and have its author fix the pull request and report its updated state.",
    };
  }
  if (blocker.substatus === "ready_to_merge") {
    return {
      meaning: "Its fix is approved and waiting for a merger; dependent work remains blocked until it lands.",
      nextStep: "Open the blocking issue and follow its merge step. After it is live, check whether this issue can proceed.",
    };
  }
  if (blocker.status === "merge") {
    return {
      meaning: "Its fix is in the merge process and has not reached a live environment yet.",
      nextStep: "Open the blocking issue and follow the next step shown there; resume this issue when that work is live.",
    };
  }
  if (blocker.status === "done") {
    return {
      meaning: "Its delivered fix is being tested or reviewed before it can merge.",
      nextStep: "Open the blocking issue and follow the review feedback until its fix is accepted and merged.",
    };
  }
  if (blocker.status === "in_progress") {
    return {
      meaning: "Someone is still implementing the prerequisite work.",
      nextStep: "Open the blocking issue to see who owns it and what they need to deliver before this work can continue.",
    };
  }
  return {
    meaning: "The prerequisite issue is still open, so this work is waiting for it to be completed.",
    nextStep: "Open the blocking issue, help move its next step forward, and return here when it is live.",
  };
}
