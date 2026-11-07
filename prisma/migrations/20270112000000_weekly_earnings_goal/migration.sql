-- Your earnings (#earnings): a person's own weekly goal. Nullable, so every existing row is unchanged.
ALTER TABLE "User" ADD COLUMN "weeklyEarningsGoal" DECIMAL(10,2);
