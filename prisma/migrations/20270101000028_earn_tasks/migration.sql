-- Earn marketing tasks (#earn-tasks): where each person is on each task.
-- Additive only: a new enum and a new table.

-- CreateEnum
CREATE TYPE "EarnTaskStatus" AS ENUM ('started', 'submitted', 'confirmed', 'rejected');

-- CreateTable
CREATE TABLE "EarnTaskProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskKey" TEXT NOT NULL,
    "status" "EarnTaskStatus" NOT NULL DEFAULT 'started',
    "proof" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "note" TEXT,

    CONSTRAINT "EarnTaskProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EarnTaskProgress_status_submittedAt_idx" ON "EarnTaskProgress"("status", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EarnTaskProgress_userId_taskKey_key" ON "EarnTaskProgress"("userId", "taskKey");

-- AddForeignKey
ALTER TABLE "EarnTaskProgress" ADD CONSTRAINT "EarnTaskProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
