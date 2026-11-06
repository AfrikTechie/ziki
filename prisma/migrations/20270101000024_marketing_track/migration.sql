-- The marketing track (docs/marketing-migration-plan.md, F2). Additive: every
-- existing row becomes `product` and nothing else about it changes.

-- D5: marketing task types show only in the Marketing section.
ALTER TABLE "IssueType" ADD COLUMN     "track" "WorkTrack" NOT NULL DEFAULT 'product';

-- D4: revision rounds. D6: the optional link to a related product issue.
ALTER TABLE "Bug" ADD COLUMN     "linkedIssueId" TEXT,
ADD COLUMN     "revisionCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "track" "WorkTrack" NOT NULL DEFAULT 'product';

-- D4: how many times work can be sent back before it reopens for bids.
ALTER TABLE "ProjectWorkflow" ADD COLUMN     "revisionLimit" INTEGER NOT NULL DEFAULT 2;

-- D1: marketing work has no pull request, so these can be null, and its deliveries carry links.
ALTER TABLE "Delivery" ADD COLUMN     "deliverableUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "pullRequestUrl" DROP NOT NULL;

ALTER TABLE "MergeReview" ALTER COLUMN "pullRequestUrl" DROP NOT NULL;

ALTER TABLE "Idea" ADD COLUMN     "rationale" TEXT,
ADD COLUMN     "track" "WorkTrack" NOT NULL DEFAULT 'product';

-- CreateIndex
CREATE INDEX "Bug_projectId_track_status_idx" ON "Bug"("projectId", "track", "status");

-- CreateIndex
CREATE INDEX "Bug_linkedIssueId_idx" ON "Bug"("linkedIssueId");

-- CreateIndex
CREATE INDEX "Idea_projectId_track_status_idx" ON "Idea"("projectId", "track", "status");

-- AddForeignKey
ALTER TABLE "Bug" ADD CONSTRAINT "Bug_linkedIssueId_fkey" FOREIGN KEY ("linkedIssueId") REFERENCES "Bug"("id") ON DELETE SET NULL ON UPDATE CASCADE;
