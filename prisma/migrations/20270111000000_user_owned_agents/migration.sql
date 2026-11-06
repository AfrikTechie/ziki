-- Agents are their owner's, activated per organisation (#user-agents).
--
-- An agent belonged to one organisation, and its newer keys to one project.
-- Now a person owns their agents once; every organisation they belong to may
-- use them all, and they choose which to activate where. An activated agent
-- works in every project of that organisation.
--
--   * AgentActivation: one row per agent and organisation it is active in,
--     holding that organisation's grants (class, rate budget). Every existing
--     agent gets one in the organisation it belonged to, with its class and
--     budget, active since it was created.
--   * AgentApiKey: the organisation it works in (its agent's), instead of a
--     project. Every existing key keeps working, now across its organisation.
--   * AgentPairing loses its project; Agent loses its organisation, class,
--     budget and the per-project "personal agent" link.
--
-- Every agent stays, owned by the same person and active where it was. Rows
-- are only moved: no agent, key, claim or point is deleted.
--
-- It runs while the previous version still serves traffic, so it takes its
-- locks first, all at once and without waiting (NOWAIT, retried for up to
-- ~30 s), inside the one statement that changes everything: it can't
-- deadlock (20270110000000_organisations once did), and it applies whole or
-- not at all. A second run finds it done and changes nothing.

DO $$
DECLARE
  attempt int := 0;
BEGIN
  -- Already done (a second run).
  IF to_regclass('public."AgentActivation"') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Agent' AND column_name = 'organisationId') THEN
    RETURN;
  END IF;

  LOOP
    BEGIN
      LOCK TABLE "Agent", "AgentApiKey", "AgentPairing", "Organisation", "Project" IN ACCESS EXCLUSIVE MODE NOWAIT;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      attempt := attempt + 1;
      IF attempt >= 300 THEN
        RAISE EXCEPTION 'Could not lock the agent tables after % tries', attempt;
      END IF;
      PERFORM pg_sleep(0.1);
    END;
  END LOOP;

  -- 1. Activations, from where each agent belonged.
  CREATE TABLE "AgentActivation" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "level" "AgentLevel" NOT NULL DEFAULT 'working',
    "levelChangedAt" TIMESTAMP(3),
    "burst" BOOLEAN NOT NULL DEFAULT false,
    "burstUntil" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentActivation_pkey" PRIMARY KEY ("id")
  );
  INSERT INTO "AgentActivation" ("id", "agentId", "organisationId", "level", "levelChangedAt", "burst", "burstUntil", "activatedAt", "createdAt", "updatedAt")
  SELECT 'c' || substr(md5(random()::text || clock_timestamp()::text || a."id"), 1, 24),
         a."id", a."organisationId", a."level", a."levelChangedAt", a."burst", a."burstUntil", a."createdAt", a."createdAt", now()
  FROM "Agent" a;
  CREATE INDEX "AgentActivation_organisationId_idx" ON "AgentActivation"("organisationId");
  CREATE UNIQUE INDEX "AgentActivation_agentId_organisationId_key" ON "AgentActivation"("agentId", "organisationId");
  ALTER TABLE "AgentActivation" ADD CONSTRAINT "AgentActivation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  ALTER TABLE "AgentActivation" ADD CONSTRAINT "AgentActivation_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

  -- 2. Keys: their agent's organisation, every project in it.
  ALTER TABLE "AgentApiKey" ADD COLUMN "organisationId" TEXT;
  UPDATE "AgentApiKey" k SET "organisationId" = a."organisationId" FROM "Agent" a WHERE a."id" = k."agentId";
  ALTER TABLE "AgentApiKey" ALTER COLUMN "organisationId" SET NOT NULL;
  ALTER TABLE "AgentApiKey" DROP CONSTRAINT IF EXISTS "AgentApiKey_projectId_fkey";
  DROP INDEX IF EXISTS "AgentApiKey_agentId_projectId_idx";
  ALTER TABLE "AgentApiKey" DROP COLUMN "projectId";
  CREATE INDEX "AgentApiKey_agentId_organisationId_idx" ON "AgentApiKey"("agentId", "organisationId");
  ALTER TABLE "AgentApiKey" ADD CONSTRAINT "AgentApiKey_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

  -- 3. Pairing: no project.
  ALTER TABLE "AgentPairing" DROP CONSTRAINT IF EXISTS "AgentPairing_projectId_fkey";
  ALTER TABLE "AgentPairing" DROP COLUMN "projectId";

  -- 4. The username default no longer passes an organisation (the helper never used it).
  CREATE OR REPLACE FUNCTION agent_username_default_trigger() RETURNS trigger LANGUAGE plpgsql AS $fn$
  BEGIN
    IF NEW."username" IS NULL OR btrim(NEW."username") = '' THEN
      NEW."username" := agent_default_username(NEW."name", NULL, NEW."id");
    END IF;
    RETURN NEW;
  END;
  $fn$;

  -- 5. Agent: its owner's, nobody's organisation.
  ALTER TABLE "Agent" DROP CONSTRAINT IF EXISTS "Agent_organisationId_fkey";
  ALTER TABLE "Agent" DROP CONSTRAINT IF EXISTS "Agent_defaultProjectId_fkey";
  DROP INDEX IF EXISTS "Agent_organisationId_idx";
  DROP INDEX IF EXISTS "Agent_ownerUserId_defaultProjectId_key";
  ALTER TABLE "Agent" DROP COLUMN "burst", DROP COLUMN "burstUntil", DROP COLUMN "defaultProjectId",
    DROP COLUMN "level", DROP COLUMN "levelChangedAt", DROP COLUMN "organisationId";
END $$;
