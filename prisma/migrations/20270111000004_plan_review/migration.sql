-- Plan review (#plan-review), step 2 of 2: an issue's difficulty, the plan as
-- the Plan review step's entry, its revisions, replies under a plan, the
-- project's plan review window, and the claim index that counts a planning
-- claim as holding its issue. (Step 1, the enum values, is the previous migration.)
--
-- It runs while the previous version still serves traffic, and it touches
-- busy tables (Bug, Comment, IssueClaim, Agent, User). Taking those locks one
-- after another in one transaction is what deadlocked 20270110000000_organisations
-- on its first deploy (40P01). So this is one statement that takes every lock
-- it needs at once, without waiting (NOWAIT): if any table is busy it lets go
-- of all of them, pauses and tries again, for up to ~30 s. Holding nothing
-- while it waits, it can't deadlock; once it holds them all, the changes take
-- milliseconds. Every step skips what a previous run already created, so a
-- failed run is safe to run again (scripts/migrate.mjs).

DO $$
DECLARE
  attempt int := 0;
BEGIN
  LOOP
    BEGIN
      -- All or nothing: a failed NOWAIT rolls this block back and releases what it took.
      LOCK TABLE "Bug", "ProjectWorkflow", "Comment", "IssueClaim", "Agent", "User" IN ACCESS EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      attempt := attempt + 1;
      IF attempt >= 300 THEN
        RAISE EXCEPTION 'Could not lock the tables for plan review after % tries', attempt;
      END IF;
      PERFORM pg_sleep(0.1);
    END;
  END LOOP;

  -- The issue's difficulty, set at conversion.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Bug' AND column_name = 'difficulty') THEN
    ALTER TABLE "Bug" ADD COLUMN "difficulty" "Difficulty" NOT NULL DEFAULT 'medium';
  END IF;

  -- The project's plan review window.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ProjectWorkflow' AND column_name = 'planReviewSeconds') THEN
    ALTER TABLE "ProjectWorkflow" ADD COLUMN "planReviewSeconds" INTEGER NOT NULL DEFAULT 7200;
  END IF;

  -- The plan: the Plan review step's entry, one per claim.
  IF to_regclass('public."Plan"') IS NULL THEN
    CREATE TABLE "Plan" (
      "id" TEXT NOT NULL,
      "bugId" TEXT NOT NULL,
      "claimId" TEXT NOT NULL,
      "agentId" TEXT NOT NULL,
      "ownerId" TEXT NOT NULL,
      "summary" TEXT NOT NULL,
      "description" TEXT NOT NULL,
      "reading" TEXT NOT NULL,
      "assumptions" TEXT NOT NULL,
      "uncertainties" TEXT NOT NULL,
      "steps" JSONB NOT NULL,
      "estimateMinutes" INTEGER NOT NULL,
      "risk" "PlanScale" NOT NULL,
      "confidence" "PlanScale" NOT NULL,
      "round" INTEGER NOT NULL DEFAULT 1,
      "submittedAt" TIMESTAMP(3) NOT NULL,
      "decision" "PlanDecision",
      "decidedAt" TIMESTAMP(3),
      "decisionNote" TEXT,
      "reviewBy" TIMESTAMP(3) NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
    );
    CREATE UNIQUE INDEX "Plan_claimId_key" ON "Plan"("claimId");
    CREATE INDEX "Plan_bugId_createdAt_idx" ON "Plan"("bugId", "createdAt");
    ALTER TABLE "Plan" ADD CONSTRAINT "Plan_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES "Bug"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    ALTER TABLE "Plan" ADD CONSTRAINT "Plan_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "IssueClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    ALTER TABLE "Plan" ADD CONSTRAINT "Plan_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    ALTER TABLE "Plan" ADD CONSTRAINT "Plan_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- Every submitted and decided version of a plan.
  IF to_regclass('public."PlanRevision"') IS NULL THEN
    CREATE TABLE "PlanRevision" (
      "id" TEXT NOT NULL,
      "planId" TEXT NOT NULL,
      "round" INTEGER NOT NULL,
      "kind" TEXT NOT NULL,
      "steps" JSONB NOT NULL,
      "reading" TEXT NOT NULL,
      "assumptions" TEXT NOT NULL,
      "uncertainties" TEXT NOT NULL,
      "estimateMinutes" INTEGER NOT NULL,
      "risk" "PlanScale" NOT NULL,
      "confidence" "PlanScale" NOT NULL,
      "note" TEXT,
      "byUserId" TEXT NOT NULL,
      "byAgentId" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PlanRevision_pkey" PRIMARY KEY ("id")
    );
    CREATE INDEX "PlanRevision_planId_createdAt_idx" ON "PlanRevision"("planId", "createdAt");
    ALTER TABLE "PlanRevision" ADD CONSTRAINT "PlanRevision_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- Replies under a plan.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Comment' AND column_name = 'planId') THEN
    ALTER TABLE "Comment" ADD COLUMN "planId" TEXT;
    CREATE INDEX "Comment_planId_idx" ON "Comment"("planId");
    ALTER TABLE "Comment" ADD CONSTRAINT "Comment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- One planning claim per issue, like one pending offer and one active claim.
  IF to_regclass('public."IssueClaim_one_planning_claim_per_bug_key"') IS NULL THEN
    CREATE UNIQUE INDEX "IssueClaim_one_planning_claim_per_bug_key"
    ON "IssueClaim"("bugId")
    WHERE "status" = 'planning' AND "releasedAt" IS NULL;
  END IF;
END $$;
