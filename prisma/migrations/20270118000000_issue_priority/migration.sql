-- Issue priority (#issue-priority): low, medium, high or urgent. Defaults to medium.
ALTER TABLE "Bug" ADD COLUMN "priority" TEXT NOT NULL DEFAULT 'medium';
