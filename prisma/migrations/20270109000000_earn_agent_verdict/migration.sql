-- Earn (#earn-agent-review): a manager agent's advice on a submitted marketing task. A person still decides.
CREATE TYPE "EarnAgentVerdict" AS ENUM ('ready', 'send_back');

ALTER TABLE "EarnTaskProgress"
  ADD COLUMN "agentVerdict" "EarnAgentVerdict",
  ADD COLUMN "agentReason" TEXT,
  ADD COLUMN "agentConfidence" INTEGER,
  ADD COLUMN "agentVerdictById" TEXT,
  ADD COLUMN "agentVerdictAt" TIMESTAMP(3);
