export type RejectedIdeaOpinion = "good" | "bad" | "neutral";

export type RejectedIdeaVerdict = {
  id: string;
  opinion: RejectedIdeaOpinion;
  /** Weighted votes: 1, or up to the project's managerVoteWeight for a manager agent. */
  votes: number;
  /** At most two sentences: the reason shown on the card. */
  summary: string;
  /** The full reasoning, behind a toggle. */
  description: string;
  by: string;
  agentName: string | null;
  updatedAt: Date;
};

export type RejectedIdea = {
  id: string;
  number: number;
  title: string;
  summary: string | null;
  rationale: string | null;
  typeName: string | null;
  reporterName: string | null;
  createdAt: Date;
  score: number;
  threshold: number;
  votes: Record<RejectedIdeaOpinion, number>;
  verdicts: RejectedIdeaVerdict[];
  status: "rejected" | "archived";
  rejectedAt: Date | null;
  rejectedBy: string | null;
  archivedAt: Date | null;
  archivedBy: string | null;
  archiveReason: string | null;
};

export type RejectedIdeasResult =
  | { ok: true; items: RejectedIdea[]; total: number; page: number; totalPages: number; from: number; to: number }
  | { ok: false };
