import { z } from "zod";
import type { Difficulty } from "@prisma/client";

/**
 * An issue's difficulty (#plan-review): easy, medium, hard or complex. The
 * converting agent sets it when it converts the idea; anyone may change it
 * until the issue takes its first bid, after which it is fixed. Only a complex
 * issue's award goes through plan review, and a complex issue can't be staked.
 */
export const DIFFICULTIES = ["easy", "medium", "hard", "complex"] as const;

export const difficultySchema = z.enum(DIFFICULTIES);

export const difficultyLabel: Record<Difficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  complex: "Complex",
};

/** Whether the award on an issue of this difficulty opens plan review instead of a plain offer. */
export function needsPlanReview(difficulty: Difficulty | string): boolean {
  return difficulty === "complex";
}

/** The 409 body when a difficulty change comes after the first bid. */
export const DIFFICULTY_LOCKED = {
  error: "difficulty_locked",
  message: "This issue's difficulty is fixed: it already has a bid.",
} as const;
