-- #pr-checks: each check on the reported pull request's head commit, by name.
-- Null on reports that carry only the `checks` summary.
ALTER TABLE "PullRequestReport" ADD COLUMN "checkRuns" JSONB;
