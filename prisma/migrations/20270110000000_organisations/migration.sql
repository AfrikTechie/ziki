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
--
-- It runs while the previous version still serves traffic. Its first deploy
-- (2026-11-06) deadlocked: it held a lock on one table and waited for another
-- that a live query held, while that query waited for the first. So it now
-- takes every lock it needs at once, without waiting (NOWAIT): if any table is
-- busy it lets go of all of them, pauses and tries again, for up to ~30 s.
-- Holding nothing while it waits, it can't deadlock; once it holds them all,
-- the renames take milliseconds.

CREATE OR REPLACE FUNCTION pg_temp.org_name(n text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(replace(n, 'Tenant', 'Organisation'), 'tenant', 'organisation')
$$;

-- One statement, so the locks it takes are held until every rename is done.
DO $$
DECLARE
  tables text;
  attempt int := 0;
  r record;
BEGIN
  -- Every table something below renames: tables named after tenants, tables
  -- with a tenant column, and tables whose constraints, indexes or triggers carry the name.
  SELECT string_agg(format('%I', relname), ', ' ORDER BY relname) INTO tables FROM (
    SELECT c.relname FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname ILIKE '%tenant%'
    UNION SELECT table_name FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name ILIKE '%tenant%'
    UNION SELECT t.relname FROM pg_constraint k JOIN pg_class t ON t.oid = k.conrelid
     WHERE t.relnamespace = 'public'::regnamespace AND k.conname ILIKE '%tenant%'
    UNION SELECT t.relname FROM pg_index i JOIN pg_class x ON x.oid = i.indexrelid JOIN pg_class t ON t.oid = i.indrelid
     WHERE t.relnamespace = 'public'::regnamespace AND x.relname ILIKE '%tenant%'
    UNION SELECT c.relname FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid
     WHERE NOT g.tgisinternal AND c.relnamespace = 'public'::regnamespace AND g.tgname ILIKE '%tenant%'
  ) names;
  IF tables IS NULL THEN
    RETURN; -- Nothing left to rename (a second run).
  END IF;
  LOOP
    BEGIN
      -- All or nothing: a failed NOWAIT rolls this block back and releases what it took.
      EXECUTE 'LOCK TABLE ' || tables || ' IN ACCESS EXCLUSIVE MODE NOWAIT';
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      attempt := attempt + 1;
      IF attempt >= 300 THEN
        RAISE EXCEPTION 'Could not lock the tables to rename after % tries', attempt;
      END IF;
      PERFORM pg_sleep(0.1);
    END;
  END LOOP;

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
