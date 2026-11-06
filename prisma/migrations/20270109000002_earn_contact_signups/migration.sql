-- Earn (#earn-outreach): which Ziki account a business made after opening an earner's link, and when it started its first project.
ALTER TABLE "EarnContact"
  ADD COLUMN "signedUpUserId" TEXT,
  ADD COLUMN "signedUpAt" TIMESTAMP(3),
  ADD COLUMN "startedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "EarnContact_signedUpUserId_key" ON "EarnContact"("signedUpUserId");
