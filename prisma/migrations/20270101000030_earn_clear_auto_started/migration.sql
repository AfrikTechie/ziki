-- Earn (#earn-tasks): a task now starts only when the earner opens it. Before that change, opening Marketing
-- started all four tasks at once, so earners who never opened a task were shown "In progress". Clear those
-- rows: started, nothing sent in, never decided. No proof and no money is attached to them, and the task
-- starts again the moment the earner opens it.
DELETE FROM "EarnTaskProgress"
WHERE "status" = 'started'
  AND "proof" IS NULL
  AND "submittedAt" IS NULL
  AND "decidedAt" IS NULL;
