-- Phase 9 (ADR-016): generated videos have no parsed dimensions, and job lists are read per kind.
-- No new tables: Row Level Security on attachments and generation_jobs was enabled in Phase 8.

-- DropIndex
DROP INDEX "generation_jobs_userId_createdAt_idx";

-- AlterTable
ALTER TABLE "attachments" ALTER COLUMN "width" DROP NOT NULL,
ALTER COLUMN "height" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "generation_jobs_userId_kind_createdAt_idx" ON "generation_jobs"("userId", "kind", "createdAt" DESC);
