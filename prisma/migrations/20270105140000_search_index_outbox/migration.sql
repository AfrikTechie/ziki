CREATE TABLE "SearchIndexOutbox" (
  "id" BIGSERIAL PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "tenantId" TEXT,
  "projectId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "SearchIndexOutbox_status_availableAt_id_idx"
  ON "SearchIndexOutbox"("status", "availableAt", "id");
CREATE INDEX "SearchIndexOutbox_status_processedAt_id_idx"
  ON "SearchIndexOutbox"("status", "processedAt", "id");
CREATE INDEX "SearchIndexOutbox_kind_sourceId_status_id_idx"
  ON "SearchIndexOutbox"("kind", "sourceId", "status", "id");

CREATE TABLE "SearchIndexControl" (
  "id" INTEGER PRIMARY KEY CHECK ("id" = 1),
  "indexingEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "leaseOwner" TEXT,
  "leaseUntil" TIMESTAMP(3)
);
INSERT INTO "SearchIndexControl"("id") VALUES (1);

CREATE FUNCTION enqueue_work_item_search_change() RETURNS TRIGGER AS $$
DECLARE
  row_id TEXT;
  row_tenant TEXT;
  row_project TEXT;
  enabled BOOLEAN;
BEGIN
  SELECT "indexingEnabled" INTO enabled FROM "SearchIndexControl" WHERE "id"=1;
  IF NOT COALESCE(enabled, FALSE) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    row_id := OLD."id";
    row_tenant := OLD."tenantId";
    row_project := OLD."projectId";
    INSERT INTO "SearchIndexOutbox"("kind", "sourceId", "action", "tenantId", "projectId")
      VALUES (TG_ARGV[0], row_id, 'delete', row_tenant, row_project);
    RETURN OLD;
  END IF;

  row_id := NEW."id";
  row_tenant := NEW."tenantId";
  row_project := NEW."projectId";
  INSERT INTO "SearchIndexOutbox"("kind", "sourceId", "action", "tenantId", "projectId")
    VALUES (TG_ARGV[0], row_id, 'upsert', row_tenant, row_project);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Bug_search_index_change"
  AFTER INSERT OR UPDATE OR DELETE ON "Bug"
  FOR EACH ROW EXECUTE FUNCTION enqueue_work_item_search_change('bug');
CREATE TRIGGER "Idea_search_index_change"
  AFTER INSERT OR UPDATE OR DELETE ON "Idea"
  FOR EACH ROW EXECUTE FUNCTION enqueue_work_item_search_change('idea');
