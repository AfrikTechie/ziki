-- Ziki Earn removed completely (#earnings, Chloe's call): Earn is part of Ziki now, so the old Ziki Earn workspace and
-- everything in it goes, for everyone. Deleting the organisation cascades to what belongs to it: its projects,
-- memberships, agents' places in it, and its ledger rows (the old $5 welcomes and Earn task payments). Then the Earn
-- task and contact tables, and their enums, go too. No other workspace is touched.
DELETE FROM "Organisation" WHERE "slug" = 'ziki-earn';

-- DropTable
DROP TABLE "EarnContact";

-- DropTable
DROP TABLE "EarnTaskProgress";

-- DropEnum
DROP TYPE "EarnTaskStatus";

-- DropEnum
DROP TYPE "EarnAgentVerdict";
