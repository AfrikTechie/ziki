-- Additive repair for 20261019030000_milestones.
-- migrate deploy can stop on an earlier failure, so the issue detail page
-- asks for Bug.milestoneId and Milestone table before that migration has run. No drops.

CREATE TABLE IF NOT EXISTS "Milestone" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" DATE,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- Before #516, milestone titles were globally unique. Once Milestone.organisationId
-- exists, the migration owns the organisation-scoped index; creating the old global
-- one here would make two organisations unable to reuse a title.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'Milestone'
      AND column_name = 'organisationId'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS "Milestone_title_key" ON "Milestone"("title")';
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "Milestone_isClosed_dueDate_idx" ON "Milestone"("isClosed", "dueDate");

ALTER TABLE "Bug" ADD COLUMN IF NOT EXISTS "milestoneId" TEXT;
CREATE INDEX IF NOT EXISTS "Bug_milestoneId_idx" ON "Bug"("milestoneId");

DO $$
BEGIN
  ALTER TABLE "Bug"
    ADD CONSTRAINT "Bug_milestoneId_fkey"
    FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
