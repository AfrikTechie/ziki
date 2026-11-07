CREATE TABLE "SavedIssueView" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "status" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SavedIssueView_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SavedIssueView_userId_projectId_name_key" ON "SavedIssueView"("userId", "projectId", "name");
CREATE INDEX "SavedIssueView_projectId_idx" ON "SavedIssueView"("projectId");
ALTER TABLE "SavedIssueView" ADD CONSTRAINT "SavedIssueView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SavedIssueView" ADD CONSTRAINT "SavedIssueView_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
