-- Every existing workspace gets the default marketing task types. A name the
-- workspace already uses is left as it is: DO NOTHING covers every unique index,
-- including the case-insensitive one some databases have.
INSERT INTO "IssueType" ("id", "tenantId", "name", "description", "isActive", "track", "updatedAt")
SELECT 'dmt_' || md5(t."id" || ':' || d.name), t."id", d.name, d.description, true, 'marketing'::"WorkTrack", CURRENT_TIMESTAMP
FROM "Tenant" t
CROSS JOIN (VALUES
  ('Blog post', 'A post on the project''s blog.'),
  ('Social post', 'A post or thread on a social network.'),
  ('Email or newsletter', 'An email or newsletter sent to the project''s audience.'),
  ('Landing page copy', 'Copy for a page on the website.'),
  ('Graphic', 'An image or visual asset.'),
  ('Video', 'A video or short clip.'),
  ('Case study', 'A write-up of how someone used the product.'),
  ('Outreach', 'Reaching out to a person, community or publication.')
) AS d(name, description)
ON CONFLICT DO NOTHING;

-- The site link now lives only on the project. Keep a link saved in the brief
-- when the project has none, if it meets the project's own rule for a site link.
UPDATE "Project" p
SET "siteUrl" = b."website"
FROM "ProjectBrief" b
WHERE b."projectId" = p."id"
  AND (p."siteUrl" IS NULL OR p."siteUrl" = '')
  AND b."website" ~* '^https://[^/@[:space:]]+([/?#][^[:space:]]*)?$'
  AND b."website" !~* '^https://([^/]*\.)?example\.(com|org|net)([/?#:]|$)';
