-- The schema declares @@unique([agentId, url]) on WebhookSubscription, but no
-- migration created the index. IF NOT EXISTS: a database may already have it.
-- If duplicates exist, it is skipped rather than failing, because a failed
-- migration takes the deploy down. Nothing queries by this key, and
-- lib/webhooks/manage.ts checks for an existing subscription when creating one.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "WebhookSubscription" GROUP BY "agentId", "url" HAVING count(*) > 1) THEN
    RAISE NOTICE 'WebhookSubscription has duplicate (agentId, url) rows; skipping its unique index';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS "WebhookSubscription_agentId_url_key" ON "WebhookSubscription"("agentId", "url");
  END IF;
END $$;
