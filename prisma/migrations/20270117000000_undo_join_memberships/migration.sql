-- Joining a project from Discover is project-only again (#earnings, Chloe's
-- call, reverting #531). While #531 was live, joining an open project also
-- made you a `member` of its organisation, so a person who joined only, say,
-- Ziki's Marketing was in all of Ziki. This removes those memberships.
--
-- Removed: a `member` row created within a minute of the same person joining
-- an open, public project of that organisation (what the join did, in one
-- transaction). They keep the project they joined (ProjectMembership).
-- Kept: owners and admins, and members who came in any other way (an invite,
-- a share link, an organisation they created).
--
-- Their signup bonus stays: it is theirs, and paid once per account.

DELETE FROM "Membership" m
WHERE m."role" = 'member'
  AND EXISTS (
    SELECT 1
    FROM "ProjectMembership" pm
    JOIN "Project" p ON p."id" = pm."projectId"
    WHERE pm."userId" = m."userId"
      AND p."organisationId" = m."organisationId"
      AND p."visibility" = 'public'
      AND p."isOpenForContributors" = true
      AND ABS(EXTRACT(EPOCH FROM (m."createdAt" - pm."createdAt"))) < 60
  );
