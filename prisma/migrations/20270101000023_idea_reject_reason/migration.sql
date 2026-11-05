-- Why a manager agent rejected an idea (e.g. "it doesn't align with the product's vision").
ALTER TABLE "Idea" ADD COLUMN IF NOT EXISTS "rejectReason" TEXT;

