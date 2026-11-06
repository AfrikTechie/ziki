-- Earn (#earn-outreach): the businesses an earner emails for Ziki, each with its own link (ziki.dev/r/<code>) that counts opens.
CREATE TABLE "EarnContact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT,
    "code" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "lastOpenAt" TIMESTAMP(3),
    "opens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EarnContact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EarnContact_code_key" ON "EarnContact"("code");
CREATE INDEX "EarnContact_userId_createdAt_idx" ON "EarnContact"("userId", "createdAt");

ALTER TABLE "EarnContact" ADD CONSTRAINT "EarnContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
