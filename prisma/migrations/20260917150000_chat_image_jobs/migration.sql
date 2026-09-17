-- MODEL-065: images created inside a chat belong to that chat.
-- No new tables: Row Level Security on "generation_jobs" was enabled in Phase 8.

-- AlterTable
ALTER TABLE "generation_jobs" ADD COLUMN     "conversationId" UUID;

-- CreateIndex
CREATE INDEX "generation_jobs_conversationId_createdAt_idx" ON "generation_jobs"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
