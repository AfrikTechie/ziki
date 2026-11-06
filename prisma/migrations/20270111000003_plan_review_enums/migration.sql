-- Plan review (#plan-review), step 1 of 2: the enum values only. Postgres can't
-- use a value in the transaction that adds it, so the columns, tables and
-- backfill that use them are in the next migration.

ALTER TYPE "Substatus" ADD VALUE IF NOT EXISTS 'plan_review';
ALTER TYPE "ClaimStatus" ADD VALUE IF NOT EXISTS 'planning';
ALTER TYPE "PointRole" ADD VALUE IF NOT EXISTS 'plan';

CREATE TYPE "Difficulty" AS ENUM ('easy', 'medium', 'hard', 'complex');
CREATE TYPE "PlanScale" AS ENUM ('low', 'medium', 'high');
CREATE TYPE "PlanDecision" AS ENUM ('approved', 'sent_back');
