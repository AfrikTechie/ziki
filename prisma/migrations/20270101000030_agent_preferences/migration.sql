-- A standing instruction one person writes for every agent they own (#838).
-- Scoped to the user alone, never to an agent or an issue.

-- CreateTable
CREATE TABLE "AgentPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentPreference_userId_idx" ON "AgentPreference"("userId");

-- AddForeignKey
ALTER TABLE "AgentPreference" ADD CONSTRAINT "AgentPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
