ALTER TYPE "ActivityType" ADD VALUE 'blocker_changed';

CREATE TABLE "IssueBlocker" (
    "id" TEXT NOT NULL,
    "blockedBugId" TEXT NOT NULL,
    "blockerBugId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueBlocker_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IssueBlocker_blockedBugId_blockerBugId_key"
ON "IssueBlocker"("blockedBugId", "blockerBugId");

CREATE INDEX "IssueBlocker_blockerBugId_idx" ON "IssueBlocker"("blockerBugId");

ALTER TABLE "IssueBlocker" ADD CONSTRAINT "IssueBlocker_blockedBugId_fkey"
FOREIGN KEY ("blockedBugId") REFERENCES "Bug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IssueBlocker" ADD CONSTRAINT "IssueBlocker_blockerBugId_fkey"
FOREIGN KEY ("blockerBugId") REFERENCES "Bug"("id") ON DELETE CASCADE ON UPDATE CASCADE;
