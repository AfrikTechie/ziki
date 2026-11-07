-- Public issue intake is explicitly opt-in per project.
ALTER TABLE "Project"
ADD COLUMN "acceptsGuestIdeas" BOOLEAN NOT NULL DEFAULT false;

-- Guest submissions remain ordinary ideas in the existing review lifecycle.
-- Only a hash of the tracking token is persisted.
ALTER TABLE "Idea"
ADD COLUMN "source" TEXT NOT NULL DEFAULT 'internal',
ADD COLUMN "publicTrackingTokenHash" TEXT;

CREATE UNIQUE INDEX "Idea_publicTrackingTokenHash_key"
ON "Idea"("publicTrackingTokenHash");
