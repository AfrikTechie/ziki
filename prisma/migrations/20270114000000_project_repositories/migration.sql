-- More GitHub repositories per project (#2). Project.repoUrl stays the main
-- repository; this table holds the others. Nothing existing is copied or changed.

-- CreateTable
CREATE TABLE "ProjectRepository" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "branch" TEXT,
    "githubInstallationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectRepository_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectRepository_projectId_idx" ON "ProjectRepository"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectRepository_projectId_url_key" ON "ProjectRepository"("projectId", "url");

-- AddForeignKey
ALTER TABLE "ProjectRepository" ADD CONSTRAINT "ProjectRepository_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
