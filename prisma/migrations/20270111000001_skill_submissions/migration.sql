-- Skill submissions to the skills library (#skill-submissions).
-- Contributors submit skills (test runners, linters, security guardrails);
-- a super admin reviews and approves or rejects each one.
-- An approved submission is published to the skills directory.
--
-- A new table and enum, plus reserving /skills as a top-level route: an
-- organisation or project already using that slug is renamed the way the
-- reserved-slug migrations do (<slug>-org / <slug>-project, then -2, -3, ...).
--
-- It runs while the previous version still serves traffic, and its foreign keys
-- lock "User". So it takes its locks first, all at once and without waiting
-- (NOWAIT, retried for up to ~30 s), inside the one statement that changes
-- everything: it can't deadlock (20270110000000_organisations once did), and it
-- applies whole or not at all. A second run finds it done and changes nothing.

DO $$
DECLARE
  lock_attempt INT := 0;
  rec RECORD;
  candidate TEXT;
  attempt INT;
BEGIN
  -- Already done (a second run).
  IF to_regclass('public."SkillSubmission"') IS NOT NULL THEN
    RETURN;
  END IF;

  LOOP
    BEGIN
      LOCK TABLE "User", "Organisation", "Project" IN SHARE ROW EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      lock_attempt := lock_attempt + 1;
      IF lock_attempt >= 300 THEN
        RAISE EXCEPTION 'Could not lock the skill submission tables after % tries', lock_attempt;
      END IF;
      PERFORM pg_sleep(0.1);
    END;
  END LOOP;

  FOR rec IN
    SELECT "id", "slug" FROM "Organisation" WHERE "slug" = 'skills' ORDER BY "createdAt", "id"
  LOOP
    candidate := rec."slug" || '-org';
    attempt := 2;
    WHILE EXISTS (SELECT 1 FROM "Organisation" WHERE "slug" = candidate) LOOP
      candidate := rec."slug" || '-org-' || attempt;
      attempt := attempt + 1;
    END LOOP;
    UPDATE "Organisation" SET "slug" = candidate, "updatedAt" = NOW() WHERE "id" = rec."id";
  END LOOP;

  FOR rec IN
    SELECT "id", "organisationId", "slug" FROM "Project" WHERE "slug" = 'skills' ORDER BY "createdAt", "id"
  LOOP
    candidate := rec."slug" || '-project';
    attempt := 2;
    WHILE EXISTS (
      SELECT 1 FROM "Project" WHERE "organisationId" = rec."organisationId" AND "slug" = candidate
    ) LOOP
      candidate := rec."slug" || '-project-' || attempt;
      attempt := attempt + 1;
    END LOOP;
    UPDATE "Project" SET "slug" = candidate, "updatedAt" = NOW() WHERE "id" = rec."id";
  END LOOP;

  CREATE TYPE "SkillSubmissionStatus" AS ENUM ('pending', 'approved', 'rejected');

  CREATE TABLE "SkillSubmission" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "categoryLabel" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "tags" TEXT[],
    "prompt" TEXT NOT NULL,
    "checklist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sampleCommand" TEXT,
    "documentationUrl" TEXT,
    "status" "SkillSubmissionStatus" NOT NULL DEFAULT 'pending',
    "submittedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillSubmission_pkey" PRIMARY KEY ("id")
  );

  CREATE UNIQUE INDEX "SkillSubmission_slug_key" ON "SkillSubmission"("slug");
  CREATE INDEX "SkillSubmission_status_idx" ON "SkillSubmission"("status");
  CREATE INDEX "SkillSubmission_submittedById_idx" ON "SkillSubmission"("submittedById");
  CREATE INDEX "SkillSubmission_createdAt_idx" ON "SkillSubmission"("createdAt");

  ALTER TABLE "SkillSubmission" ADD CONSTRAINT "SkillSubmission_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE "SkillSubmission" ADD CONSTRAINT "SkillSubmission_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
END $$;
