-- #github-status: Ziki reads pull requests on GitHub itself, beside agent reports.
CREATE TYPE "PullRequestReportSource" AS ENUM ('agent', 'ziki');

ALTER TABLE "PullRequestReport"
  ADD COLUMN "source" "PullRequestReportSource" NOT NULL DEFAULT 'agent',
  ADD COLUMN "details" JSONB,
  ADD COLUMN "checkedAt" TIMESTAMP(3),
  ALTER COLUMN "agentId" DROP NOT NULL,
  ALTER COLUMN "onBehalfOfUserId" DROP NOT NULL;
