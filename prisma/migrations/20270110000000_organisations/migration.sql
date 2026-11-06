-- Tenants are organisations (#organisations), in the database too.
--
-- The app called the same thing a tenant (in the code and here), a workspace
-- and an organization. It is an organisation everywhere now:
--
--   * tables:      Tenant, TenantInvite, TenantShareLink, TenantShareRedemption
--                  -> Organisation, OrganisationInvite, ...
--   * columns:     tenantId (25 tables) -> organisationId
--   * constraints and indexes named after them, as Prisma names them
--   * functions:   assign_tenant_bug_number, assign_tenant_idea_number (and
--                  the bodies of every function that reads a tenant column)
--   * triggers:    Bug_assign_tenant_number, Idea_assign_tenant_number
--   * data:        notifications of kind tenant_invite -> organisation_invite
--
-- Renaming keeps every row, key and reference: Postgres follows a renamed
-- table or column everywhere except inside function bodies, which are
-- rewritten here. A second run finds nothing left to rename.

CREATE OR REPLACE FUNCTION pg_temp.org_name(n text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(replace(n, 'Tenant', 'Organisation'), 'tenant', 'organisation')
$$;

DO $$
DECLARE r record;
BEGIN
  -- Tables.
  FOR r IN SELECT c.relname FROM pg_class c
           WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname ILIKE '%tenant%' LOOP
    EXECUTE format('ALTER TABLE %I RENAME TO %I', r.relname, pg_temp.org_name(r.relname));
  END LOOP;

  -- Columns.
  FOR r IN SELECT table_name, column_name FROM information_schema.columns
           WHERE table_schema = 'public' AND column_name ILIKE '%tenant%' LOOP
    EXECUTE format('ALTER TABLE %I RENAME COLUMN %I TO %I', r.table_name, r.column_name, pg_temp.org_name(r.column_name));
  END LOOP;

  -- Constraints (a primary key or unique constraint renames its index with it).
  FOR r IN SELECT t.relname AS table_name, c.conname FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
           WHERE t.relnamespace = 'public'::regnamespace AND c.conname ILIKE '%tenant%' LOOP
    EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', r.table_name, r.conname, pg_temp.org_name(r.conname));
  END LOOP;

  -- The other indexes.
  FOR r IN SELECT c.relname FROM pg_class c
           WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'i' AND c.relname ILIKE '%tenant%' LOOP
    EXECUTE format('ALTER INDEX %I RENAME TO %I', r.relname, pg_temp.org_name(r.relname));
  END LOOP;

  -- Functions: renamed (their triggers follow), then their bodies rewritten for the new names.
  FOR r IN SELECT p.oid, p.proname FROM pg_proc p
           WHERE p.pronamespace = 'public'::regnamespace AND p.proname ILIKE '%tenant%' LOOP
    EXECUTE format('ALTER FUNCTION %I() RENAME TO %I', r.proname, pg_temp.org_name(r.proname));
  END LOOP;
  FOR r IN SELECT p.oid FROM pg_proc p
           WHERE p.pronamespace = 'public'::regnamespace AND p.prosrc ILIKE '%tenant%' LOOP
    EXECUTE pg_temp.org_name(pg_get_functiondef(r.oid));
  END LOOP;

  -- Triggers.
  FOR r IN SELECT t.tgname, c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
           WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace AND t.tgname ILIKE '%tenant%' LOOP
    EXECUTE format('ALTER TRIGGER %I ON %I RENAME TO %I', r.tgname, r.relname, pg_temp.org_name(r.tgname));
  END LOOP;
END $$;

UPDATE "Notification" SET "kind" = 'organisation_invite' WHERE "kind" = 'tenant_invite';
