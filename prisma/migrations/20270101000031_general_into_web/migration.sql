-- General goes into Web (#no-general), a one-off.
--
-- 20270101000027_platforms_become_projects made each organisation's oldest
-- project "General" (keeping its old slug, so /zedu/zedu/...) to hold the
-- issues and ideas that had no platform. General isn't a real project, so in
-- every organisation that has one:
--
--   * when the organisation has a Web project, everything on General moves to
--     Web (issues, ideas, stakes, areas, notes, goals, jobs, missions, agent
--     keys and defaults, history) and the empty General is deleted;
--   * when it has none, General becomes Web.
--
-- General's old addresses are not redirected. Issue and idea numbers are per
-- organisation and don't change. A second run finds no General and does nothing.

LOCK TABLE "Project", "Bug", "Idea" IN SHARE ROW EXCLUSIVE MODE;

-- OR REPLACE: on a fresh database every migration runs in one session, and
-- 20270101000027 already made this temporary function in it.
CREATE OR REPLACE FUNCTION pg_temp.new_id() RETURNS text LANGUAGE sql AS $$
  SELECT 'c' || substr(md5(random()::text || clock_timestamp()::text), 1, 24)
$$;

-- Each General and the organisation's Web (by slug `web` first, else by name).
CREATE TEMP TABLE general_web ON COMMIT DROP AS
SELECT g.id AS general_id, g."tenantId" AS tenant_id,
       (SELECT w.id FROM "Project" w
        WHERE w."tenantId" = g."tenantId" AND w.id <> g.id AND (w.slug = 'web' OR lower(w.name) = 'web')
        ORDER BY (w.slug = 'web') DESC, (w."archivedAt" IS NOT NULL), w."createdAt", w.id LIMIT 1) AS web_id
FROM "Project" g
WHERE g.name = 'General';

-- 1. No Web: General becomes it, under the slug `web` when that is free.
UPDATE "Project" p SET name = 'Web', "archivedAt" = NULL, "updatedAt" = now(),
  slug = CASE WHEN EXISTS (SELECT 1 FROM "Project" x WHERE x."tenantId" = p."tenantId" AND x.slug = 'web') THEN p.slug ELSE 'web' END
FROM general_web gw WHERE p.id = gw.general_id AND gw.web_id IS NULL;
DELETE FROM general_web WHERE web_id IS NULL;

-- 2. Areas: Web gets the ones it lacks (by slug); issues, ideas and agents' area
--    preferences follow by slug before General's areas go with it.
INSERT INTO "ProjectArea" (id, "projectId", name, slug, description, paths, "createdAt", "updatedAt")
SELECT pg_temp.new_id(), gw.web_id, a.name, a.slug, a.description, a.paths, a."createdAt", now()
FROM general_web gw JOIN "ProjectArea" a ON a."projectId" = gw.general_id
WHERE NOT EXISTS (SELECT 1 FROM "ProjectArea" x WHERE x."projectId" = gw.web_id AND x.slug = a.slug);

CREATE TEMP TABLE area_map ON COMMIT DROP AS
SELECT oa.id AS old_area, na.id AS new_area
FROM general_web gw
JOIN "ProjectArea" oa ON oa."projectId" = gw.general_id
JOIN "ProjectArea" na ON na."projectId" = gw.web_id AND na.slug = oa.slug;

INSERT INTO "AgentAreaPreference" ("agentId", "projectAreaId")
SELECT DISTINCT p."agentId", m.new_area FROM "AgentAreaPreference" p JOIN area_map m ON m.old_area = p."projectAreaId"
ON CONFLICT DO NOTHING;

-- 3. Issues, ideas and stakes.
UPDATE "Bug" b SET "projectId" = gw.web_id, "areaId" = (SELECT m.new_area FROM area_map m WHERE m.old_area = b."areaId")
FROM general_web gw WHERE b."projectId" = gw.general_id;
UPDATE "Idea" i SET "projectId" = gw.web_id, "areaId" = (SELECT m.new_area FROM area_map m WHERE m.old_area = i."areaId")
FROM general_web gw WHERE i."projectId" = gw.general_id;
UPDATE "IssueStake" x SET "projectId" = gw.web_id FROM general_web gw WHERE x."projectId" = gw.general_id;

-- 4. Everything else on General.
UPDATE "Goal" x SET "projectId" = gw.web_id FROM general_web gw WHERE x."projectId" = gw.general_id;
UPDATE "Job" x SET "projectId" = gw.web_id FROM general_web gw WHERE x."projectId" = gw.general_id;
UPDATE "RedesignProposal" x SET "projectId" = gw.web_id FROM general_web gw WHERE x."projectId" = gw.general_id;
UPDATE "AgentMistake" x SET "projectId" = gw.web_id FROM general_web gw WHERE x."projectId" = gw.general_id;
UPDATE "ProjectAuditEvent" x SET "projectId" = gw.web_id FROM general_web gw WHERE x."projectId" = gw.general_id;
UPDATE "AgentNote" x SET "projectId" = gw.web_id FROM general_web gw WHERE x."projectId" = gw.general_id;
UPDATE "AgentEvent" x SET "projectId" = gw.web_id FROM general_web gw WHERE x."projectId" = gw.general_id;
UPDATE "AgentPairing" x SET "projectId" = gw.web_id FROM general_web gw WHERE x."projectId" = gw.general_id;
UPDATE "AgentApiKey" x SET "projectId" = gw.web_id FROM general_web gw WHERE x."projectId" = gw.general_id;
UPDATE "ProjectNoteComment" x SET "projectId" = gw.web_id FROM general_web gw WHERE x."projectId" = gw.general_id;
UPDATE "TestMission" x SET "projectId" = gw.web_id FROM general_web gw
WHERE x."projectId" = gw.general_id
  AND NOT EXISTS (SELECT 1 FROM "TestMission" y WHERE y."projectId" = gw.web_id AND y."routePattern" = x."routePattern" AND y.role = x.role AND y.viewport = x.viewport);

-- Notes: General's move when Web has none; otherwise General's text is added
-- under Web's, as a new version.
UPDATE "ProjectNotes" n SET body = n.body || E'\n\n## From General\n\n' || g.body, version = n.version + 1, "updatedAt" = now()
FROM general_web gw JOIN "ProjectNotes" g ON g."projectId" = gw.general_id
WHERE n."projectId" = gw.web_id AND btrim(g.body) <> '';
UPDATE "ProjectNotes" x SET "projectId" = gw.web_id FROM general_web gw
WHERE x."projectId" = gw.general_id AND NOT EXISTS (SELECT 1 FROM "ProjectNotes" y WHERE y."projectId" = gw.web_id);
UPDATE "ProjectNoteRevision" x SET "projectId" = gw.web_id FROM general_web gw
WHERE x."projectId" = gw.general_id AND NOT EXISTS (SELECT 1 FROM "ProjectNoteRevision" y WHERE y."projectId" = gw.web_id);

-- Personal agents (one per owner per project): General's becomes Web's when its
-- owner has none there, otherwise an ordinary agent.
UPDATE "Agent" a SET "defaultProjectId" = CASE
    WHEN EXISTS (SELECT 1 FROM "Agent" y WHERE y."ownerUserId" = a."ownerUserId" AND y."defaultProjectId" = gw.web_id) THEN NULL
    ELSE gw.web_id END
FROM general_web gw WHERE a."defaultProjectId" = gw.general_id;

-- 5. General, now empty, goes.
DELETE FROM "Project" p USING general_web gw WHERE p.id = gw.general_id;
