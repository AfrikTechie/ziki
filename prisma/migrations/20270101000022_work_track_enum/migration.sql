-- The marketing track (docs/marketing-migration-plan.md, F2): which kind of work
-- an idea or issue is. The columns that use it come in 20270101000024.
CREATE TYPE "WorkTrack" AS ENUM ('product', 'marketing');
