-- Additive only: no existing records or workflow states change.
CREATE TABLE "FeaturePlan" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "request" TEXT NOT NULL,
    "draft" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FeaturePlan_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "FeaturePlanItem" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "ideaId" TEXT,
    "bugId" TEXT,
    CONSTRAINT "FeaturePlanItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FeaturePlan_projectId_createdAt_idx" ON "FeaturePlan"("projectId", "createdAt");
CREATE INDEX "FeaturePlan_creatorId_idx" ON "FeaturePlan"("creatorId");
CREATE UNIQUE INDEX "FeaturePlanItem_planId_position_key" ON "FeaturePlanItem"("planId", "position");
CREATE INDEX "FeaturePlanItem_ideaId_idx" ON "FeaturePlanItem"("ideaId");
CREATE INDEX "FeaturePlanItem_bugId_idx" ON "FeaturePlanItem"("bugId");
ALTER TABLE "FeaturePlan" ADD CONSTRAINT "FeaturePlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeaturePlan" ADD CONSTRAINT "FeaturePlan_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeaturePlanItem" ADD CONSTRAINT "FeaturePlanItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "FeaturePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeaturePlanItem" ADD CONSTRAINT "FeaturePlanItem_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FeaturePlanItem" ADD CONSTRAINT "FeaturePlanItem_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES "Bug"("id") ON DELETE SET NULL ON UPDATE CASCADE;
