-- Addresses now start with the organisation (#project-urls):
-- /<org>/<project>/<number>. An organisation slug is the first segment, so it
-- may not be the name of a top-level route, and a project slug is the second,
-- so it may not be one of the old project page names (tasks, workstream, work)
-- or only digits, which read as old /<project>/<page> and /<project>/<number>
-- addresses. The lists match RESERVED_PROJECT_SLUGS in lib/project-slug.ts.
--
-- Organisations that use one are renamed to <slug>-org (then -org-2, ...);
-- projects to <slug>-project (then -project-2, ...) within their organisation.
-- Idempotent: a second run finds nothing to rename.
DO $$
DECLARE
  reserved TEXT[] := ARRAY['actions', 'api', 'developers', 'fonts', 'for-agents', 'how-it-works', 'session-expired', 'activity', 'superadmin', 'agent', 'agents', 'docs', 'earn', 'escalations', 'inbox', 'feed', 'home', 'ideas', 'issues', 'jobs', 'leaderboard', 'marketing', 'milestones', 'notes', 'notifications', 'org', 'points', 'projects', 'questions', 'tasks', 'workstream', 'work', 'redesigns', 'security', 'settings', 'team', 'tenants', 'users', 'workers', 'forgot-password', 'join', 'login', 'reset-password', 'signup', 'apple-icon', 'favicon', 'icon', 'icon1', 'icon2', 'llms', 'manifest', 'opengraph-image', 'robots', 'sitemap', 'sitemaps', 'twitter-image', 'bug-tracker', 'bugs', 'brand', 'homepage', 'icons'];
  rec RECORD;
  candidate TEXT;
  attempt INT;
BEGIN
  FOR rec IN
    SELECT "id", "slug" FROM "Tenant" WHERE "slug" = ANY(reserved) ORDER BY "createdAt", "id"
  LOOP
    candidate := rec."slug" || '-org';
    attempt := 2;
    WHILE EXISTS (SELECT 1 FROM "Tenant" WHERE "slug" = candidate) LOOP
      candidate := rec."slug" || '-org-' || attempt;
      attempt := attempt + 1;
    END LOOP;
    UPDATE "Tenant" SET "slug" = candidate, "updatedAt" = NOW() WHERE "id" = rec."id";
  END LOOP;

  FOR rec IN
    SELECT "id", "tenantId", "slug" FROM "Project"
    WHERE "slug" = ANY(reserved) OR "slug" ~ '^[0-9]+$'
    ORDER BY "createdAt", "id"
  LOOP
    candidate := rec."slug" || '-project';
    attempt := 2;
    WHILE EXISTS (SELECT 1 FROM "Project" WHERE "tenantId" = rec."tenantId" AND "slug" = candidate) LOOP
      candidate := rec."slug" || '-project-' || attempt;
      attempt := attempt + 1;
    END LOOP;
    UPDATE "Project" SET "slug" = candidate, "updatedAt" = NOW() WHERE "id" = rec."id";
  END LOOP;
END $$;
