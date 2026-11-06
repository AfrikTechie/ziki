-- Additive repair for 20261021000000_agent_platform:
-- Ensures organisations, projects, memberships, agent platform schema, and Bug/Comment columns exist.
-- Safe, additive, idempotent: no data loss, no drops.

-- 1. Create Enums safely
DO $$ BEGIN CREATE TYPE "MembershipRole" AS ENUM ('owner', 'admin', 'member'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "AgentLevel" AS ENUM ('observer', 'contributor', 'reviewer', 'merger'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ClaimStatus" AS ENUM ('offered', 'active', 'released'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ValidationKind" AS ENUM ('real', 'format', 'duplicate', 'fix'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ValidationVerdict" AS ENUM ('accept', 'reject'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "RedesignStatus" AS ENUM ('proposed', 'approved', 'rejected'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "PointRole" AS ENUM ('solver', 'reporter', 'reviewer'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "DisputeStatus" AS ENUM ('open', 'granted', 'rejected'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('pending', 'delivered', 'failed', 'dead'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Alter Bug and Comment with nullable columns first
ALTER TABLE "Bug" ADD COLUMN IF NOT EXISTS "organisationId" TEXT;
ALTER TABLE "Bug" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "Bug" ADD COLUMN IF NOT EXISTS "beneficiaryUserId" TEXT;
ALTER TABLE "Bug" ADD COLUMN IF NOT EXISTS "createdByAgentId" TEXT;
ALTER TABLE "Bug" ADD COLUMN IF NOT EXISTS "pullRequestUrl" TEXT;

ALTER TABLE "Comment" ADD COLUMN IF NOT EXISTS "agentId" TEXT;

-- 3. Create Tables IF NOT EXISTS
CREATE TABLE IF NOT EXISTS "Organisation" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Project" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT,
    "repoUrl" TEXT,
    "stagingUrl" TEXT,
    "githubInstallationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Membership" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Agent" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "model" TEXT,
    "level" "AgentLevel" NOT NULL DEFAULT 'observer',
    "burst" BOOLEAN NOT NULL DEFAULT false,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AgentApiKey" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentApiKey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AgentPairing" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "proposedName" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ownerUserId" TEXT,
    "organisationId" TEXT,
    "agentId" TEXT,
    "deviceCodeHash" TEXT NOT NULL,
    "proposedModel" TEXT,
    "consumedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentPairing_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AgentAuditEvent" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "bugId" TEXT,
    "actorUserId" TEXT,
    "payload" JSONB,
    "undoneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "IssueClaim" (
    "id" TEXT NOT NULL,
    "bugId" TEXT NOT NULL,
    "beneficiaryUserId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'active',
    "offeredAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "releaseReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueClaim_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "IssueValidation" (
    "id" TEXT NOT NULL,
    "bugId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "onBehalfOfUserId" TEXT NOT NULL,
    "kind" "ValidationKind" NOT NULL,
    "verdict" "ValidationVerdict" NOT NULL,
    "notes" TEXT,
    "duplicateOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueValidation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TestVerdict" (
    "id" TEXT NOT NULL,
    "bugId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "onBehalfOfUserId" TEXT NOT NULL,
    "goodToMerge" BOOLEAN NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestVerdict_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RedesignProposal" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "bugId" TEXT,
    "authorAgentId" TEXT NOT NULL,
    "onBehalfOfUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "RedesignStatus" NOT NULL DEFAULT 'proposed',
    "approverId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RedesignProposal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PointEntry" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bugId" TEXT,
    "role" "PointRole" NOT NULL,
    "points" INTEGER NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "correctedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PointDispute" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pointEntryId" TEXT,
    "bugId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'open',
    "resolvedById" TEXT,
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointDispute_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AgentQuestion" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "bugId" TEXT,
    "body" TEXT NOT NULL,
    "answer" TEXT,
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentQuestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OrganisationInvite" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL DEFAULT 'member',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "invitedById" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganisationInvite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "bugId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AgentEvent" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "actorAgentId" TEXT,
    "bugId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WebhookSubscription" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "signingSecretEncrypted" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'pending',
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- 4. Create Indexes safely
CREATE UNIQUE INDEX IF NOT EXISTS "Organisation_slug_key" ON "Organisation"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "Project_organisationId_slug_key" ON "Project"("organisationId", "slug");
CREATE INDEX IF NOT EXISTS "Membership_userId_idx" ON "Membership"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "Membership_organisationId_userId_key" ON "Membership"("organisationId", "userId");
CREATE INDEX IF NOT EXISTS "Agent_organisationId_idx" ON "Agent"("organisationId");
CREATE INDEX IF NOT EXISTS "Agent_ownerUserId_idx" ON "Agent"("ownerUserId");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentApiKey_keyHash_key" ON "AgentApiKey"("keyHash");
CREATE INDEX IF NOT EXISTS "AgentApiKey_agentId_idx" ON "AgentApiKey"("agentId");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentPairing_codeHash_key" ON "AgentPairing"("codeHash");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentPairing_deviceCodeHash_key" ON "AgentPairing"("deviceCodeHash");
CREATE INDEX IF NOT EXISTS "AgentAuditEvent_organisationId_createdAt_idx" ON "AgentAuditEvent"("organisationId", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentAuditEvent_agentId_createdAt_idx" ON "AgentAuditEvent"("agentId", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentAuditEvent_bugId_createdAt_idx" ON "AgentAuditEvent"("bugId", "createdAt");
CREATE INDEX IF NOT EXISTS "IssueClaim_bugId_releasedAt_idx" ON "IssueClaim"("bugId", "releasedAt");
CREATE INDEX IF NOT EXISTS "IssueClaim_beneficiaryUserId_releasedAt_idx" ON "IssueClaim"("beneficiaryUserId", "releasedAt");
CREATE INDEX IF NOT EXISTS "IssueClaim_agentId_idx" ON "IssueClaim"("agentId");
CREATE INDEX IF NOT EXISTS "IssueValidation_bugId_kind_idx" ON "IssueValidation"("bugId", "kind");
CREATE UNIQUE INDEX IF NOT EXISTS "IssueValidation_bugId_agentId_kind_key" ON "IssueValidation"("bugId", "agentId", "kind");
CREATE INDEX IF NOT EXISTS "TestVerdict_bugId_idx" ON "TestVerdict"("bugId");
CREATE INDEX IF NOT EXISTS "TestVerdict_agentId_idx" ON "TestVerdict"("agentId");
CREATE UNIQUE INDEX IF NOT EXISTS "TestVerdict_bugId_agentId_key" ON "TestVerdict"("bugId", "agentId");
CREATE INDEX IF NOT EXISTS "RedesignProposal_organisationId_status_idx" ON "RedesignProposal"("organisationId", "status");
CREATE INDEX IF NOT EXISTS "RedesignProposal_bugId_idx" ON "RedesignProposal"("bugId");
CREATE UNIQUE INDEX IF NOT EXISTS "PointEntry_sourceKey_key" ON "PointEntry"("sourceKey");
CREATE INDEX IF NOT EXISTS "PointEntry_organisationId_userId_idx" ON "PointEntry"("organisationId", "userId");
CREATE INDEX IF NOT EXISTS "PointEntry_bugId_idx" ON "PointEntry"("bugId");
CREATE INDEX IF NOT EXISTS "PointDispute_organisationId_status_idx" ON "PointDispute"("organisationId", "status");
CREATE INDEX IF NOT EXISTS "PointDispute_userId_idx" ON "PointDispute"("userId");
CREATE INDEX IF NOT EXISTS "AgentQuestion_ownerUserId_answeredAt_idx" ON "AgentQuestion"("ownerUserId", "answeredAt");
CREATE INDEX IF NOT EXISTS "AgentQuestion_agentId_idx" ON "AgentQuestion"("agentId");
CREATE UNIQUE INDEX IF NOT EXISTS "OrganisationInvite_tokenHash_key" ON "OrganisationInvite"("tokenHash");
CREATE INDEX IF NOT EXISTS "OrganisationInvite_organisationId_idx" ON "OrganisationInvite"("organisationId");
CREATE INDEX IF NOT EXISTS "OrganisationInvite_email_idx" ON "OrganisationInvite"("email");
CREATE INDEX IF NOT EXISTS "IdempotencyKey_createdAt_idx" ON "IdempotencyKey"("createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "IdempotencyKey_agentId_key_key" ON "IdempotencyKey"("agentId", "key");
CREATE INDEX IF NOT EXISTS "AgentEvent_organisationId_createdAt_id_idx" ON "AgentEvent"("organisationId", "createdAt", "id");
CREATE INDEX IF NOT EXISTS "WebhookSubscription_agentId_idx" ON "WebhookSubscription"("agentId");
CREATE INDEX IF NOT EXISTS "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");
CREATE UNIQUE INDEX IF NOT EXISTS "WebhookDelivery_subscriptionId_eventId_key" ON "WebhookDelivery"("subscriptionId", "eventId");
CREATE INDEX IF NOT EXISTS "Bug_organisationId_projectId_idx" ON "Bug"("organisationId", "projectId");
CREATE INDEX IF NOT EXISTS "Bug_beneficiaryUserId_idx" ON "Bug"("beneficiaryUserId");
CREATE INDEX IF NOT EXISTS "Bug_createdByAgentId_idx" ON "Bug"("createdByAgentId");

-- 5. Seed default Zedu organisation, project, and memberships
INSERT INTO "Organisation" ("id", "slug", "name", "createdAt", "updatedAt")
VALUES ('organisation_zedu', 'zedu', 'Zedu', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "Project" ("id", "organisationId", "slug", "name", "createdAt", "updatedAt")
SELECT 'project_zedu', t."id", 'zedu', 'Zedu', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organisation" t WHERE t."slug" = 'zedu'
ON CONFLICT ("organisationId", "slug") DO NOTHING;

INSERT INTO "Membership" ("id", "organisationId", "userId", "role", "createdAt")
SELECT 'mem_zedu_' || u."id", t."id", u."id", 'member'::"MembershipRole", CURRENT_TIMESTAMP
FROM "User" u CROSS JOIN "Organisation" t
WHERE t."slug" = 'zedu'
ON CONFLICT ("organisationId", "userId") DO NOTHING;

-- Backfill any existing Bug rows that don't have organisationId / projectId / beneficiaryUserId
UPDATE "Bug" b
SET "organisationId" = p."organisationId",
    "projectId" = p."id",
    "beneficiaryUserId" = COALESCE(b."reporterId", u."id")
FROM "Project" p
JOIN "Organisation" t ON t."id" = p."organisationId"
CROSS JOIN LATERAL (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1) u
WHERE t."slug" = 'zedu' AND p."slug" = 'zedu'
  AND (b."organisationId" IS NULL OR b."projectId" IS NULL OR b."beneficiaryUserId" IS NULL);

-- 6. Add Foreign Keys safely
DO $$ BEGIN ALTER TABLE "Bug" ADD CONSTRAINT "Bug_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Bug" ADD CONSTRAINT "Bug_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Bug" ADD CONSTRAINT "Bug_beneficiaryUserId_fkey" FOREIGN KEY ("beneficiaryUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Bug" ADD CONSTRAINT "Bug_createdByAgentId_fkey" FOREIGN KEY ("createdByAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Comment" ADD CONSTRAINT "Comment_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Project" ADD CONSTRAINT "Project_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Agent" ADD CONSTRAINT "Agent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Agent" ADD CONSTRAINT "Agent_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AgentApiKey" ADD CONSTRAINT "AgentApiKey_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AgentPairing" ADD CONSTRAINT "AgentPairing_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AgentAuditEvent" ADD CONSTRAINT "AgentAuditEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AgentAuditEvent" ADD CONSTRAINT "AgentAuditEvent_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AgentAuditEvent" ADD CONSTRAINT "AgentAuditEvent_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES "Bug"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AgentAuditEvent" ADD CONSTRAINT "AgentAuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "IssueClaim" ADD CONSTRAINT "IssueClaim_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES "Bug"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "IssueClaim" ADD CONSTRAINT "IssueClaim_beneficiaryUserId_fkey" FOREIGN KEY ("beneficiaryUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "IssueClaim" ADD CONSTRAINT "IssueClaim_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "IssueValidation" ADD CONSTRAINT "IssueValidation_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES "Bug"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "IssueValidation" ADD CONSTRAINT "IssueValidation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "IssueValidation" ADD CONSTRAINT "IssueValidation_onBehalfOfUserId_fkey" FOREIGN KEY ("onBehalfOfUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "TestVerdict" ADD CONSTRAINT "TestVerdict_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES "Bug"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "TestVerdict" ADD CONSTRAINT "TestVerdict_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "TestVerdict" ADD CONSTRAINT "TestVerdict_onBehalfOfUserId_fkey" FOREIGN KEY ("onBehalfOfUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "RedesignProposal" ADD CONSTRAINT "RedesignProposal_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "RedesignProposal" ADD CONSTRAINT "RedesignProposal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "RedesignProposal" ADD CONSTRAINT "RedesignProposal_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES "Bug"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "RedesignProposal" ADD CONSTRAINT "RedesignProposal_authorAgentId_fkey" FOREIGN KEY ("authorAgentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "RedesignProposal" ADD CONSTRAINT "RedesignProposal_onBehalfOfUserId_fkey" FOREIGN KEY ("onBehalfOfUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "RedesignProposal" ADD CONSTRAINT "RedesignProposal_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "PointEntry" ADD CONSTRAINT "PointEntry_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "PointEntry" ADD CONSTRAINT "PointEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "PointEntry" ADD CONSTRAINT "PointEntry_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES "Bug"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "PointDispute" ADD CONSTRAINT "PointDispute_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "PointDispute" ADD CONSTRAINT "PointDispute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "PointDispute" ADD CONSTRAINT "PointDispute_pointEntryId_fkey" FOREIGN KEY ("pointEntryId") REFERENCES "PointEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "PointDispute" ADD CONSTRAINT "PointDispute_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "PointDispute" ADD CONSTRAINT "PointDispute_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES "Bug"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AgentQuestion" ADD CONSTRAINT "AgentQuestion_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AgentQuestion" ADD CONSTRAINT "AgentQuestion_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AgentQuestion" ADD CONSTRAINT "AgentQuestion_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES "Bug"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "OrganisationInvite" ADD CONSTRAINT "OrganisationInvite_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "OrganisationInvite" ADD CONSTRAINT "OrganisationInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES "Bug"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AgentEvent" ADD CONSTRAINT "AgentEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AgentEvent" ADD CONSTRAINT "AgentEvent_actorAgentId_fkey" FOREIGN KEY ("actorAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "AgentEvent" ADD CONSTRAINT "AgentEvent_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES "Bug"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "WebhookSubscription" ADD CONSTRAINT "WebhookSubscription_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "WebhookSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "AgentEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
