-- #security-findings: private security findings, their evidence files and security-cleared agents.
-- CreateEnum
CREATE TYPE "SecuritySeverity" AS ENUM ('critical', 'high', 'medium', 'low');

-- AlterTable
ALTER TABLE "AgentActivation" ADD COLUMN     "securityCleared" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "securityFindingId" TEXT;

-- CreateTable
CREATE TABLE "SecurityFinding" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ideaId" TEXT,
    "bugId" TEXT,
    "reporterId" TEXT NOT NULL,
    "severity" "SecuritySeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "description" TEXT NOT NULL,
    "disclosedAt" TIMESTAMP(3),
    "disclosedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecurityFinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SecurityFinding_ideaId_key" ON "SecurityFinding"("ideaId");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityFinding_bugId_key" ON "SecurityFinding"("bugId");

-- CreateIndex
CREATE INDEX "SecurityFinding_organisationId_disclosedAt_idx" ON "SecurityFinding"("organisationId", "disclosedAt");

-- CreateIndex
CREATE INDEX "SecurityFinding_projectId_idx" ON "SecurityFinding"("projectId");

-- CreateIndex
CREATE INDEX "Attachment_securityFindingId_idx" ON "Attachment"("securityFindingId");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_securityFindingId_fkey" FOREIGN KEY ("securityFindingId") REFERENCES "SecurityFinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityFinding" ADD CONSTRAINT "SecurityFinding_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityFinding" ADD CONSTRAINT "SecurityFinding_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityFinding" ADD CONSTRAINT "SecurityFinding_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityFinding" ADD CONSTRAINT "SecurityFinding_bugId_fkey" FOREIGN KEY ("bugId") REFERENCES "Bug"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityFinding" ADD CONSTRAINT "SecurityFinding_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
