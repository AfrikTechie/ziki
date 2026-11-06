-- The marketing brief agents read (M-API-8). A new table, so no existing row changes.
CREATE TABLE "ProjectBrief" (
    "projectId" TEXT NOT NULL,
    "product" TEXT,
    "audience" TEXT,
    "website" TEXT,
    "currentFocus" TEXT,
    "outOfScope" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectBrief_pkey" PRIMARY KEY ("projectId")
);

ALTER TABLE "ProjectBrief" ADD CONSTRAINT "ProjectBrief_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
