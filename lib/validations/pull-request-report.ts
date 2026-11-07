import { z } from "zod";

/**
 * The body of `POST /api/v1/issues/{id}/pull-request-status` (#pr-reports): what
 * an agent saw when it checked the issue's linked pull request on GitHub.
 * Ziki never asks GitHub itself; the latest report is the pull request's state.
 */

const sha = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{7,64}$/i, "Send a hexadecimal commit SHA.");

const branch = z.string().trim().min(1).max(255);

export const PULL_REQUEST_STATES = ["open", "closed", "merged", "not_found"] as const;
export const PULL_REQUEST_CHECKS = ["passing", "failing", "pending", "none", "unknown"] as const;

/**
 * The state of one check on the pull request's head commit (#pr-checks). Every
 * conclusion GitHub reports has a home here, plus `unavailable` for a check the
 * agent could not read (a private repository it has no access to, a check that
 * was never run): unavailable is never shown as a pass.
 */
export const PULL_REQUEST_CHECK_STATUSES = [
  "passed",
  "failed",
  "pending",
  "cancelled",
  "skipped",
  "neutral",
  "unavailable",
] as const;

export type PullRequestCheckStatus = (typeof PULL_REQUEST_CHECK_STATUSES)[number];
export type PullRequestChecks = (typeof PULL_REQUEST_CHECKS)[number];

/** One check on the head commit: its name, what it did, and where to look. */
export type PullRequestCheck = {
  name: string;
  status: PullRequestCheckStatus;
  /** The check run or workflow on GitHub. */
  url?: string;
  /** One line of failure context, when GitHub gives the agent any. */
  summary?: string;
};

/** More than this is a list, not a status: the note carries the rest. */
export const PULL_REQUEST_CHECK_RUNS_MAX = 100;

/** An https:// link only: the card renders it as an anchor. */
const checkUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => /^https:\/\/\S+$/i.test(value), "Send the check's https:// link.");

const checkRunSchema = z
  .object({
    name: z.string().trim().min(1, "Name the check.").max(120),
    status: z.enum(PULL_REQUEST_CHECK_STATUSES),
    url: checkUrl.optional(),
    summary: z.string().trim().max(280).optional(),
  })
  .strict();

/** The checks on the head commit, in the order GitHub lists them. */
export const checkRunsSchema = z
  .array(checkRunSchema)
  .max(PULL_REQUEST_CHECK_RUNS_MAX, `Send at most ${PULL_REQUEST_CHECK_RUNS_MAX} checks; put the rest in the note.`);

/**
 * What a set of checks amounts to in the words `checks` uses. A failed check is
 * `failing`; so is a cancelled one, because it never proved the commit and will
 * not finish without a re-run. Then anything still running is `pending`, any
 * check the agent could not read is `unknown`, no checks at all is `none`, and
 * everything else `passing`. Skipped and neutral checks do not hold a merge up,
 * so they leave the summary as they find it.
 *
 * Empty check detail (no checks listed) is `unknown`, not `none`: the absence
 * of evidence is not evidence of absence. Only an explicit `checks: "none"`
 * without checkRuns confirms that no checks are configured.
 */
export function pullRequestChecksSummary(checkRuns: readonly { status: PullRequestCheckStatus }[]): PullRequestChecks {
  if (!checkRuns.length) return "unknown";
  if (checkRuns.some((check) => check.status === "failed" || check.status === "cancelled")) return "failing";
  if (checkRuns.some((check) => check.status === "pending")) return "pending";
  if (checkRuns.some((check) => check.status === "unavailable")) return "unknown";
  return "passing";
}

export const pullRequestReportSchema = z
  .object({
    /** The pull request checked: must be the issue's linked one. */
    pullRequestUrl: z.string().trim().min(1).max(2048),
    /** `closed` means closed without being merged; `not_found` means GitHub answers 404. */
    state: z.enum(PULL_REQUEST_STATES),
    /** The branch it was merged into (with `merged`). */
    mergedInto: branch.optional(),
    /** Whether the repository's default branch contains its merge commit (with `merged`). */
    inDefaultBranch: z.boolean().optional(),
    /** Its head commit now. */
    headSha: sha.optional(),
    /** Its merge commit (with `merged`). */
    mergeCommitSha: sha.optional(),
    /** Every check, status and deployment on the head commit: all passing, any failing, any still running, or none at all. */
    checks: z.enum(PULL_REQUEST_CHECKS).optional(),
    /**
     * The same checks one by one, by name (#pr-checks), so the issue can say
     * which failed. Send this and `checks` may be left out: Ziki works the
     * summary out from it. Send both and they must agree.
     */
    checkRuns: checkRunsSchema.optional(),
    /** False when GitHub says it conflicts with its base branch. */
    mergeable: z.boolean().optional(),
    /** What you saw, in a sentence or two. */
    note: z.string().trim().min(1, "Add a note: what you saw on GitHub.").max(1000),
    projectId: z.string().trim().min(1).max(191).optional(),
  })
  .strict()
  .refine((body) => body.state === "merged" || (body.mergedInto === undefined && body.inDefaultBranch === undefined && body.mergeCommitSha === undefined), {
    message: "mergedInto, inDefaultBranch and mergeCommitSha go with state \"merged\" only.",
    path: ["state"],
  })
  .refine((body) => body.state !== "merged" || body.inDefaultBranch !== undefined, {
    message: "Say whether the default branch contains the merge (inDefaultBranch).",
    path: ["inDefaultBranch"],
  });

export type PullRequestReportInput = z.infer<typeof pullRequestReportSchema>;
