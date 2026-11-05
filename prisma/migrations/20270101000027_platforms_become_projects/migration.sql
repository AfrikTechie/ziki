-- Platforms become projects (#no-platforms).
--
-- An organisation (tenant) now holds projects and nothing in between: the
-- platforms (the "Category" table: Desktop, Web, Mobile, ...) are gone. In each
-- organisation:
--
--   * its oldest project becomes "General", keeping its id, slug, settings,
--     notes and history, and holds every issue and idea that had no
--     platform;
--   * each platform becomes a project of the same name and slug, with a copy of
--     the settings of the project most of its issues came from (workflow, goal,
--     URLs, rewards, notes, areas), and its issues and ideas move into it;
--   * any other old project goes: what hangs off it moves to General first.
--
-- Access is by organisation membership, so everyone who could see the old
-- project sees every new one. Agent keys were scoped to one project; they now
-- work across the organisation (projectId NULL), so no agent loses access.
-- Issue and idea numbers are per organisation and don't change.

LOCK TABLE "Project", "Bug", "Idea", "Category" IN SHARE ROW EXCLUSIVE MODE;

CREATE FUNCTION pg_temp.new_id() RETURNS text LANGUAGE sql AS $$
  SELECT 'c' || substr(md5(random()::text || clock_timestamp()::text), 1, 24)
$$;

-- A project slug free in the organisation and not a top-level route (lib/project-slug.ts).
CREATE FUNCTION pg_temp.free_project_slug(tenant text, base text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  root text := coalesce(nullif(trim(both '-' from regexp_replace(lower(base), '[^a-z0-9]+', '-', 'g')), ''), 'project');
  candidate text := root;
  n int := 1;
BEGIN
  LOOP
    IF candidate <> ALL (ARRAY['actions','api','developers','fonts','for-agents','how-it-works','session-expired','activity','superadmin','agent','agents','docs','escalations','inbox','feed','home','ideas','issues','jobs','leaderboard','marketing','milestones','notes','notifications','org','points','projects','questions','redesigns','security','settings','team','tenants','users','workers','forgot-password','join','login','reset-password','signup','apple-icon','favicon','icon','icon1','icon2','llms','manifest','opengraph-image','robots','sitemap','sitemaps','twitter-image','bug-tracker','bugs','brand','homepage','icons'])
       AND NOT EXISTS (SELECT 1 FROM "Project" WHERE "tenantId" = tenant AND slug = candidate) THEN
      RETURN candidate;
    END IF;
    n := n + 1;
    candidate := root || '-' || n;
  END LOOP;
END;
$$;

-- 1. Each organisation's General project: its oldest live project, else its oldest.
CREATE TEMP TABLE general_project ON COMMIT DROP AS
SELECT DISTINCT ON (p."tenantId") p."tenantId" AS tenant_id, p.id AS project_id
FROM "Project" p
ORDER BY p."tenantId", (p."archivedAt" IS NOT NULL), p."createdAt", p.id;

-- An organisation with platforms but no project yet gets an empty General.
INSERT INTO "Project" (id, "tenantId", slug, name, "updatedAt")
SELECT pg_temp.new_id(), c."tenantId", 'general', 'General', now()
FROM (SELECT DISTINCT "tenantId" FROM "Category") c
WHERE NOT EXISTS (SELECT 1 FROM general_project g WHERE g.tenant_id = c."tenantId");
INSERT INTO general_project
SELECT p."tenantId", p.id FROM "Project" p
WHERE p.slug = 'general' AND NOT EXISTS (SELECT 1 FROM general_project g WHERE g.tenant_id = p."tenantId");
INSERT INTO "ProjectWorkflow" ("projectId", "updatedAt")
SELECT g.project_id, now() FROM general_project g
WHERE NOT EXISTS (SELECT 1 FROM "ProjectWorkflow" w WHERE w."projectId" = g.project_id);

-- The old projects that go: every one that isn't General.
CREATE TEMP TABLE old_project ON COMMIT DROP AS
SELECT p.id AS project_id, g.project_id AS general_id
FROM "Project" p JOIN general_project g ON g.tenant_id = p."tenantId"
WHERE p.id <> g.project_id;

-- General is named so but keeps the old project's slug, so every link, bookmark
-- and agent that names it still works (an issue link redirects to the issue's
-- new project).
UPDATE "Project" p SET name = 'General', "archivedAt" = NULL, "updatedAt" = now()
FROM general_project g WHERE p.id = g.project_id;

-- 2. A project for each platform that is in use or still offered.
CREATE TEMP TABLE platform_project ON COMMIT DROP AS
SELECT c.id AS category_id, c."tenantId" AS tenant_id, c.name, c.slug AS base_slug, c."createdAt" AS created_at,
       coalesce(
         (SELECT b."projectId" FROM "Bug" b WHERE b."categoryId" = c.id GROUP BY b."projectId" ORDER BY count(*) DESC, min(b."createdAt") LIMIT 1),
         (SELECT i."projectId" FROM "Idea" i WHERE i."categoryId" = c.id GROUP BY i."projectId" ORDER BY count(*) DESC, min(i."createdAt") LIMIT 1),
         g.project_id
       ) AS source_id,
       pg_temp.new_id() AS new_id,
       NULL::text AS slug
FROM "Category" c
JOIN general_project g ON g.tenant_id = c."tenantId"
WHERE c."isActive"
   OR EXISTS (SELECT 1 FROM "Bug" b WHERE b."categoryId" = c.id)
   OR EXISTS (SELECT 1 FROM "Idea" i WHERE i."categoryId" = c.id);

-- Slugs one at a time, oldest platform first, so each sees the ones before it.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM platform_project ORDER BY tenant_id, created_at, category_id LOOP
    UPDATE platform_project SET slug = pg_temp.free_project_slug(r.tenant_id, r.base_slug) WHERE category_id = r.category_id;
    INSERT INTO "Project" (id, "tenantId", slug, name, goal, "repoUrl", "siteUrl", "stagingUrl", "githubInstallationId",
                           "deliveryWindowMinutes", "ownerWaitCapMinutes", "rewardConfig", "createdAt", "updatedAt")
    SELECT r.new_id, r.tenant_id, pp.slug, r.name, s.goal, s."repoUrl", s."siteUrl", s."stagingUrl", s."githubInstallationId",
           s."deliveryWindowMinutes", s."ownerWaitCapMinutes", s."rewardConfig", now(), now()
    FROM "Project" s, platform_project pp
    WHERE s.id = r.source_id AND pp.category_id = r.category_id;
  END LOOP;
END $$;

-- Settings copied from the source project: workflow, notes, areas.
INSERT INTO "ProjectWorkflow" ("projectId", "confirmationsNeeded", "verdictsNeeded", "offerWindowSeconds", "heartbeatMinutes",
  "deliveryMinutes", "maxActiveClaims", "volunteerWindowSeconds", "autoMerge", "ideaThreshold", "abandonCheckMinutes",
  "abandonThreshold", "closeThreshold", governance, "managerVoteWeight", "awardThreshold", "acceptThreshold",
  "stakeLimit", "stakeInProgressLimit", "createdAt", "updatedAt")
SELECT pp.new_id, w."confirmationsNeeded", w."verdictsNeeded", w."offerWindowSeconds", w."heartbeatMinutes",
  w."deliveryMinutes", w."maxActiveClaims", w."volunteerWindowSeconds", w."autoMerge", w."ideaThreshold", w."abandonCheckMinutes",
  w."abandonThreshold", w."closeThreshold", w.governance, w."managerVoteWeight", w."awardThreshold", w."acceptThreshold",
  w."stakeLimit", w."stakeInProgressLimit", now(), now()
FROM platform_project pp JOIN "ProjectWorkflow" w ON w."projectId" = pp.source_id;
INSERT INTO "ProjectWorkflow" ("projectId", "updatedAt")
SELECT pp.new_id, now() FROM platform_project pp
WHERE NOT EXISTS (SELECT 1 FROM "ProjectWorkflow" w WHERE w."projectId" = pp.new_id);

INSERT INTO "ProjectNotes" ("projectId", body, version, "editorUserId", "editorAgentId", "editorName", "updatedAt")
SELECT pp.new_id, n.body, 1, n."editorUserId", n."editorAgentId", n."editorName", now()
FROM platform_project pp JOIN "ProjectNotes" n ON n."projectId" = pp.source_id;

INSERT INTO "ProjectArea" (id, "projectId", name, slug, description, paths, "createdAt", "updatedAt")
SELECT pg_temp.new_id(), pp.new_id, a.name, a.slug, a.description, a.paths, a."createdAt", now()
FROM platform_project pp JOIN "ProjectArea" a ON a."projectId" = pp.source_id;

-- Areas the platform's issues and ideas use in other old projects too, so none loses its area.
INSERT INTO "ProjectArea" (id, "projectId", name, slug, description, paths, "createdAt", "updatedAt")
SELECT DISTINCT ON (pp.new_id, a.slug) pg_temp.new_id(), pp.new_id, a.name, a.slug, a.description, a.paths, a."createdAt", now()
FROM platform_project pp
JOIN (SELECT "categoryId", "areaId" FROM "Bug" UNION SELECT "categoryId", "areaId" FROM "Idea") item ON item."categoryId" = pp.category_id
JOIN "ProjectArea" a ON a.id = item."areaId"
WHERE NOT EXISTS (SELECT 1 FROM "ProjectArea" x WHERE x."projectId" = pp.new_id AND x.slug = a.slug)
ORDER BY pp.new_id, a.slug, a."createdAt";

-- Old projects' areas General doesn't have yet, so their issues keep an area.
INSERT INTO "ProjectArea" (id, "projectId", name, slug, description, paths, "createdAt", "updatedAt")
SELECT DISTINCT ON (o.general_id, a.slug) pg_temp.new_id(), o.general_id, a.name, a.slug, a.description, a.paths, a."createdAt", now()
FROM old_project o JOIN "ProjectArea" a ON a."projectId" = o.project_id
WHERE NOT EXISTS (SELECT 1 FROM "ProjectArea" x WHERE x."projectId" = o.general_id AND x.slug = a.slug)
ORDER BY o.general_id, a.slug, a."createdAt";

-- 3. Issues and ideas move to their platform's project, or to General. An area
--    follows by slug into the new project; one it doesn't have is cleared.
CREATE TEMP TABLE item_target ON COMMIT DROP AS
SELECT 'bug'::text AS kind, b.id, b."areaId" AS old_area, coalesce(pp.new_id, g.project_id) AS target
FROM "Bug" b JOIN general_project g ON g.tenant_id = b."tenantId"
LEFT JOIN platform_project pp ON pp.category_id = b."categoryId"
UNION ALL
SELECT 'idea', i.id, i."areaId", coalesce(pp.new_id, g.project_id)
FROM "Idea" i JOIN general_project g ON g.tenant_id = i."tenantId"
LEFT JOIN platform_project pp ON pp.category_id = i."categoryId";

UPDATE "Bug" b SET "projectId" = t.target,
  "areaId" = (SELECT na.id FROM "ProjectArea" oa JOIN "ProjectArea" na ON na.slug = oa.slug AND na."projectId" = t.target WHERE oa.id = t.old_area)
FROM item_target t WHERE t.kind = 'bug' AND t.id = b.id AND (b."projectId" <> t.target OR b."areaId" IS DISTINCT FROM
  (SELECT na.id FROM "ProjectArea" oa JOIN "ProjectArea" na ON na.slug = oa.slug AND na."projectId" = t.target WHERE oa.id = t.old_area));
UPDATE "Idea" i SET "projectId" = t.target,
  "areaId" = (SELECT na.id FROM "ProjectArea" oa JOIN "ProjectArea" na ON na.slug = oa.slug AND na."projectId" = t.target WHERE oa.id = t.old_area)
FROM item_target t WHERE t.kind = 'idea' AND t.id = i.id AND (i."projectId" <> t.target OR i."areaId" IS DISTINCT FROM
  (SELECT na.id FROM "ProjectArea" oa JOIN "ProjectArea" na ON na.slug = oa.slug AND na."projectId" = t.target WHERE oa.id = t.old_area));

-- A stake is in its issue's (or idea's) project.
UPDATE "IssueStake" s SET "projectId" = b."projectId" FROM "Bug" b WHERE s."bugId" = b.id AND s."projectId" <> b."projectId";
UPDATE "IssueStake" s SET "projectId" = i."projectId" FROM "Idea" i WHERE s."bugId" IS NULL AND s."ideaId" = i.id AND s."projectId" <> i."projectId";

-- 4. Keys work across the organisation, so agents reach every new project.
UPDATE "AgentApiKey" SET "projectId" = NULL WHERE "projectId" IS NOT NULL;

-- Everything else on an old project moves to General before the project goes.
UPDATE "Goal" x SET "projectId" = o.general_id FROM old_project o WHERE x."projectId" = o.project_id;
UPDATE "Job" x SET "projectId" = o.general_id FROM old_project o WHERE x."projectId" = o.project_id;
UPDATE "RedesignProposal" x SET "projectId" = o.general_id FROM old_project o WHERE x."projectId" = o.project_id;
UPDATE "AgentMistake" x SET "projectId" = o.general_id FROM old_project o WHERE x."projectId" = o.project_id;
UPDATE "ProjectAuditEvent" x SET "projectId" = o.general_id FROM old_project o WHERE x."projectId" = o.project_id;
UPDATE "AgentNote" x SET "projectId" = o.general_id FROM old_project o WHERE x."projectId" = o.project_id;
UPDATE "AgentEvent" x SET "projectId" = o.general_id FROM old_project o WHERE x."projectId" = o.project_id;
UPDATE "AgentPairing" x SET "projectId" = o.general_id FROM old_project o WHERE x."projectId" = o.project_id;
UPDATE "TestMission" x SET "projectId" = o.general_id FROM old_project o
WHERE x."projectId" = o.project_id
  AND NOT EXISTS (SELECT 1 FROM "TestMission" y WHERE y."projectId" = o.general_id AND y."routePattern" = x."routePattern" AND y.role = x.role AND y.viewport = x.viewport);
UPDATE "ProjectNotes" x SET "projectId" = o.general_id FROM old_project o
WHERE x."projectId" = o.project_id AND NOT EXISTS (SELECT 1 FROM "ProjectNotes" y WHERE y."projectId" = o.general_id);
-- Personal agents (one per owner per project): per owner, the one already on
-- General, else the oldest on an old project, is General's; the rest of the old
-- projects' personal agents become ordinary agents.
WITH ranked AS (
  SELECT x.id, g.project_id AS general_id,
         row_number() OVER (PARTITION BY x."ownerUserId", g.project_id
                            ORDER BY (x."defaultProjectId" = g.project_id) DESC, x."createdAt", x.id) AS rn
  FROM "Agent" x
  JOIN "Project" p ON p.id = x."defaultProjectId"
  JOIN general_project g ON g.tenant_id = p."tenantId"
  WHERE x."defaultProjectId" = g.project_id OR x."defaultProjectId" IN (SELECT project_id FROM old_project)
)
UPDATE "Agent" a SET "defaultProjectId" = CASE WHEN r.rn = 1 THEN r.general_id END
FROM ranked r
WHERE a.id = r.id AND a."defaultProjectId" IS DISTINCT FROM (CASE WHEN r.rn = 1 THEN r.general_id END);

DELETE FROM "Project" p USING old_project o WHERE p.id = o.project_id;

-- A platform whose slug an old project had takes it back now that it's free.
UPDATE "Project" p SET slug = pp.base_slug
FROM platform_project pp
WHERE p.id = pp.new_id AND pp.slug <> pp.base_slug
  AND pg_temp.free_project_slug(pp.tenant_id, pp.base_slug) = pp.base_slug;

-- 5. Platforms are gone.
ALTER TABLE "Bug" DROP COLUMN "categoryId";
ALTER TABLE "Idea" DROP COLUMN "categoryId";
DROP TABLE "Category";
