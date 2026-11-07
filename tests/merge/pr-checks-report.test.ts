import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #pr-checks: an agent reports the pull request's checks one by one, so the
 * issue can name what failed instead of only saying "failing". The per-check
 * detail decides the summary the merge gate reads, and the two can never
 * disagree.
 */
const db = vi.hoisted(() => {
  const tx = {
    pullRequestReport: { create: vi.fn() },
    bug: { updateMany: vi.fn() },
    bugActivity: { create: vi.fn() },
  };
  return {
    bug: { findFirst: vi.fn() },
    delivery: { findFirst: vi.fn() },
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    tx,
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/agent-api/events", () => ({ publish: vi.fn() }));
vi.mock("@/lib/agents/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/agent-notifications", () => ({ notifyMergeFailed: vi.fn() }));

import type { AgentContext } from "@/lib/agents/require-agent";
import { reportPullRequestStatus, storedCheckRuns } from "@/lib/agent-api/pull-request-report";
import { pullRequestReportSchema, pullRequestChecksSummary, type PullRequestCheckStatus } from "@/lib/validations/pull-request-report";

const PR = "https://github.com/emerjent/ziki/pull/552";
const scope = { organisationId: "t1", projectId: "p1" };
const checker = (ownerId = "erin"): AgentContext =>
  ({ agentId: `agent-${ownerId}`, name: `${ownerId}'s agent`, ownerId, organisationId: "t1", level: "working", burst: false, keyId: "k" });

function bug(over: Record<string, unknown> = {}) {
  return {
    id: "bug1", organisationId: "t1", projectId: "p1", status: "merge", substatus: "ready_to_merge",
    pullRequestUrl: PR, pullRequestHeadSha: "aaa1111",
    beneficiaryUserId: "ada", reporterId: "ada", assigneeId: null, createdByAgent: null,
    claims: [],
    ...over,
  };
}

const baseBody = (over: Record<string, unknown> = {}) => ({
  pullRequestUrl: PR,
  state: "open",
  headSha: "aaa1111",
  checks: "passing",
  mergeable: true,
  note: "Looked at the checks tab on GitHub.",
  ...over,
});

const check = (name: string, status: string, over: Record<string, unknown> = {}) =>
  ({ name, status: status as PullRequestCheckStatus, ...over });

/** The stored row, echoing what was created. */
function savedRow(data: Record<string, unknown>) {
  return {
    id: "rep1",
    ...data,
    createdAt: new Date("2026-11-05T10:00:00Z"),
    agent: { name: "erin's agent" },
    onBehalfOf: { name: "Erin" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.bug.findFirst.mockResolvedValue(bug());
  db.delivery.findFirst.mockResolvedValue(null);
  db.tx.pullRequestReport.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => savedRow(data));
  db.tx.bug.updateMany.mockResolvedValue({ count: 0 });
});

describe("pullRequestChecksSummary (#pr-checks)", () => {
  it("reads a set of checks the way the gate's `checks` words do", () => {
    // Empty check detail is unknown, not none: absence of evidence is not evidence of absence.
    expect(pullRequestChecksSummary([])).toBe("unknown");
    expect(pullRequestChecksSummary([check("Build", "passed")])).toBe("passing");
    expect(pullRequestChecksSummary([check("Build", "passed"), check("Lint", "failed")])).toBe("failing");
    expect(pullRequestChecksSummary([check("Build", "pending")])).toBe("pending");
    // A cancelled run never proved the commit and will not finish on its own.
    expect(pullRequestChecksSummary([check("Build", "passed"), check("E2E", "cancelled")])).toBe("failing");
    // A failure outranks anything still running.
    expect(pullRequestChecksSummary([check("Lint", "failed"), check("E2E", "pending")])).toBe("failing");
    // Skipped and neutral checks hold nothing up.
    expect(pullRequestChecksSummary([check("Build", "skipped"), check("Lint", "neutral")])).toBe("passing");
    // An unreadable check is not a pass.
    expect(pullRequestChecksSummary([check("Build", "unavailable")])).toBe("unknown");
    expect(pullRequestChecksSummary([check("Build", "unavailable"), check("Lint", "passed")])).toBe("unknown");
  });

  it("fails closed for merge eligibility when checks are unavailable", () => {
    // Unavailable-only: cannot determine pass/fail.
    expect(pullRequestChecksSummary([check("Build", "unavailable"), check("Lint", "unavailable")])).toBe("unknown");
    // Failed + unavailable: failure outranks unavailable.
    expect(pullRequestChecksSummary([check("Build", "failed"), check("Lint", "unavailable")])).toBe("failing");
    // Pending + unavailable: pending outranks unavailable.
    expect(pullRequestChecksSummary([check("Build", "pending"), check("Lint", "unavailable")])).toBe("pending");
    // Mixed passed + unavailable: NOT passing.
    expect(pullRequestChecksSummary([check("Build", "passed"), check("Lint", "unavailable"), check("E2E", "passed")])).toBe("unknown");
  });
});

describe("the report's checkRuns field (#pr-checks)", () => {
  it("accepts named checks with an https link and a one-line summary", () => {
    const parsed = pullRequestReportSchema.safeParse(baseBody({
      checkRuns: [check("Prettier", "failed", { url: `${PR}/checks`, summary: "3 files need formatting." })],
    }));
    expect(parsed.success).toBe(true);
  });

  it("accepts checkRuns without a checks summary: Ziki works the summary out", () => {
    const body = baseBody();
    delete (body as Record<string, unknown>).checks;
    const parsed = pullRequestReportSchema.safeParse({ ...body, checkRuns: [check("Lint", "failed")] });
    expect(parsed.success).toBe(true);
  });

  it("refuses a check link that is not https", () => {
    for (const url of ["javascript:alert(1)", "http://github.com/x/y/runs/1", "not a url"]) {
      const parsed = pullRequestReportSchema.safeParse(baseBody({ checkRuns: [check("Lint", "failed", { url })] }));
      expect(parsed.success, url).toBe(false);
    }
  });

  it("refuses a status it would have to guess about", () => {
    const parsed = pullRequestReportSchema.safeParse(baseBody({ checkRuns: [check("Lint", "exploded")] }));
    expect(parsed.success).toBe(false);
    expect(parsed.success ? [] : parsed.error.issues[0].path).toEqual(["checkRuns", 0, "status"]);
  });

  it("refuses an unnamed check", () => {
    const parsed = pullRequestReportSchema.safeParse(baseBody({ checkRuns: [check("   ", "failed")] }));
    expect(parsed.success).toBe(false);
  });

  it("refuses extra fields on a check", () => {
    const parsed = pullRequestReportSchema.safeParse(baseBody({ checkRuns: [check("Lint", "failed", { conclusion: "failure" })] }));
    expect(parsed.success).toBe(false);
  });

  it("caps the list at 100 checks", () => {
    const hundred = Array.from({ length: 100 }, (_, i) => check(`Check ${i}`, "passed"));
    expect(pullRequestReportSchema.safeParse(baseBody({ checkRuns: hundred })).success).toBe(true);
    expect(pullRequestReportSchema.safeParse(baseBody({ checkRuns: [...hundred, check("One more", "passed")] })).success).toBe(false);
  });
});

describe("reportPullRequestStatus with checkRuns (#pr-checks)", () => {
  it("stores the checks by name and derives the summary from them (201)", async () => {
    const result = await reportPullRequestStatus(checker(), scope, "bug1", baseBody({
      checks: undefined,
      checkRuns: [
        check("Prettier", "failed", { url: `${PR}/checks`, summary: "3 files need formatting." }),
        check("ESLint", "failed"),
        check("TypeScript", "passed"),
        check("Build", "passed"),
      ],
    }));

    expect(result).toMatchObject({
      status: 201,
      body: { report: { checks: "failing", checkRuns: [
        { name: "Prettier", status: "failed", url: `${PR}/checks`, summary: "3 files need formatting." },
        { name: "ESLint", status: "failed" },
        { name: "TypeScript", status: "passed" },
        { name: "Build", status: "passed" },
      ] } },
    });
    expect(db.tx.pullRequestReport.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        checks: "failing",
        checkRuns: [
          expect.objectContaining({ name: "Prettier", status: "failed" }),
          expect.objectContaining({ name: "ESLint", status: "failed" }),
          expect.objectContaining({ name: "TypeScript", status: "passed" }),
          expect.objectContaining({ name: "Build", status: "passed" }),
        ],
      }),
    }));
  });

  it("takes an agreeing checks summary as it is (201)", async () => {
    const result = await reportPullRequestStatus(checker(), scope, "bug1", baseBody({
      checks: "pending",
      checkRuns: [check("Build", "passed"), check("E2E", "pending")],
    }));
    expect(result).toMatchObject({ status: 201, body: { report: { checks: "pending" } } });
  });

  it("refuses a summary that contradicts the checks: 400 checks_mismatch", async () => {
    const result = await reportPullRequestStatus(checker(), scope, "bug1", baseBody({
      checks: "passing",
      checkRuns: [check("Lint", "failed")],
    }));
    expect(result).toMatchObject({ status: 400, body: { error: "checks_mismatch", field: "checks" } });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a summary of \"none\" that hides a check", async () => {
    const result = await reportPullRequestStatus(checker(), scope, "bug1", baseBody({
      checks: "none",
      checkRuns: [check("Build", "passed")],
    }));
    expect(result).toMatchObject({ status: 400, body: { error: "checks_mismatch" } });
  });

  it("empty checkRuns derives unknown, not none, and contradicts an explicit none summary", async () => {
    const result = await reportPullRequestStatus(checker(), scope, "bug1", baseBody({
      checks: "none",
      checkRuns: [],
    }));
    expect(result).toMatchObject({ status: 400, body: { error: "checks_mismatch" } });
  });

  it("empty checkRuns alone stores unknown, which cannot satisfy the gate", async () => {
    const result = await reportPullRequestStatus(checker(), scope, "bug1", baseBody({
      checks: undefined,
      checkRuns: [],
    }));
    expect(result).toMatchObject({ status: 201, body: { report: { checks: "unknown" } } });
  });

  it("still takes a report with no per-check detail, exactly as before", async () => {
    const result = await reportPullRequestStatus(checker(), scope, "bug1", baseBody());
    expect(result).toMatchObject({ status: 201, body: { report: { checks: "passing", checkRuns: null } } });
  });

  it("puts Merge in Error from the derived summary when a reported check failed", async () => {
    const result = await reportPullRequestStatus(checker(), scope, "bug1", baseBody({
      checks: undefined,
      checkRuns: [check("Lint", "failed")],
    }));
    expect(result).toMatchObject({ status: 201 });
    expect(db.tx.bug.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "bug1", status: "merge" }) }),
    );
  });

  it("leaves Merge alone when every reported check passed", async () => {
    await reportPullRequestStatus(checker(), scope, "bug1", baseBody({
      checks: undefined,
      checkRuns: [check("Lint", "passed"), check("Build", "passed")],
    }));
    expect(db.tx.bug.updateMany).not.toHaveBeenCalled();
  });
});

describe("storedCheckRuns (#pr-checks)", () => {
  it("reads back what was stored", () => {
    expect(storedCheckRuns([{ name: "Lint", status: "failed" }])).toEqual([{ name: "Lint", status: "failed" }]);
  });

  it("reads anything it cannot trust as no detail rather than as a pass", () => {
    expect(storedCheckRuns(null)).toBeNull();
    expect(storedCheckRuns("failing")).toBeNull();
    expect(storedCheckRuns([])).toBeNull();
    expect(storedCheckRuns([{ name: "Lint" }])).toBeNull();
    expect(storedCheckRuns([{ name: "Lint", status: "probably fine" }])).toBeNull();
  });
});
