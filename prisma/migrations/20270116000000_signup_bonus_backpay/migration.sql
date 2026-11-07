-- Back-pays the signup bonus (#signup-bonus) to people who came in through
-- Discover (#earnings). Joining an open project didn't pay it, so a new earner
-- who joined that way shows $0. From now on joining pays it (app/actions/
-- project-join-requests.ts); this pays those who joined before.
--
-- Who: anyone who joined an open, public project and has no signup bonus yet,
-- and whose organisation memberships, if any, all came from such a join (a
-- `member` row created within a minute of joining one of that organisation's
-- open projects). Accounts that created an organisation or came in by invite
-- or share link are left alone.
-- Where: the organisation of the first project they joined, scaled by its
-- points multiplier as lib/points/award.ts does, rounded to 4 decimals.
-- Once per account: the source key is the account, as every other bonus row.

WITH open_joins AS (
  SELECT pm."userId", p."organisationId", pm."createdAt"
  FROM "ProjectMembership" pm
  JOIN "Project" p ON p."id" = pm."projectId"
  WHERE p."visibility" = 'public' AND p."isOpenForContributors" = true
),
first_join AS (
  SELECT DISTINCT ON (j."userId") j."userId", j."organisationId"
  FROM open_joins j
  ORDER BY j."userId", j."createdAt" ASC
)
INSERT INTO "PointEntry" ("id", "organisationId", "userId", "role", "points", "sourceKey", "createdAt")
SELECT
  'signup-backpay-' || f."userId",
  f."organisationId",
  f."userId",
  'signup',
  ROUND(0.67 * (CASE WHEN o."pointsMultiplier" > 0 THEN o."pointsMultiplier" ELSE 1 END), 4),
  'signup:' || f."userId",
  NOW()
FROM first_join f
JOIN "Organisation" o ON o."id" = f."organisationId"
WHERE NOT EXISTS (SELECT 1 FROM "PointEntry" e WHERE e."sourceKey" = 'signup:' || f."userId")
  AND NOT EXISTS (
    SELECT 1 FROM "Membership" m
    WHERE m."userId" = f."userId"
      AND NOT (
        m."role" = 'member'
        AND EXISTS (
          SELECT 1 FROM open_joins j
          WHERE j."userId" = m."userId"
            AND j."organisationId" = m."organisationId"
            AND ABS(EXTRACT(EPOCH FROM (m."createdAt" - j."createdAt"))) < 60
        )
      )
  )
ON CONFLICT ("sourceKey") DO NOTHING;
