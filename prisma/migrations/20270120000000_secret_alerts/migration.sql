-- Secret protection (#secret-protection): credentials found in posts. The
-- secret itself is never stored, only a keyed fingerprint and a masked preview.
CREATE TABLE "SecretAlert" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "projectId" TEXT,
    "kind" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "preview" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'blocked',
    "source" TEXT NOT NULL,
    "url" TEXT,
    "bugId" TEXT,
    "ideaId" TEXT,
    "commentId" TEXT,
    "findingId" TEXT,
    "field" TEXT,
    "line" INTEGER,
    "actorUserId" TEXT,
    "actorAgentId" TEXT,
    "agentApiKeyId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecretAlert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SecretAlert_organisationId_state_lastSeenAt_idx"
ON "SecretAlert"("organisationId", "state", "lastSeenAt");

CREATE INDEX "SecretAlert_organisationId_fingerprint_idx"
ON "SecretAlert"("organisationId", "fingerprint");

ALTER TABLE "SecretAlert" ADD CONSTRAINT "SecretAlert_organisationId_fkey"
FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
