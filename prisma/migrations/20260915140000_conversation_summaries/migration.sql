-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "summary" TEXT,
ADD COLUMN     "summaryUpToMessageId" UUID,
ADD COLUMN     "summaryUpdatedAt" TIMESTAMPTZ(3);

