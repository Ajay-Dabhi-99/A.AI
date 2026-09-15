-- CreateEnum
CREATE TYPE "generation_job_status" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "messageId" UUID,
    "kind" VARCHAR(16) NOT NULL DEFAULT 'image',
    "source" VARCHAR(16) NOT NULL DEFAULT 'upload',
    "mimeType" VARCHAR(32) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "fileName" VARCHAR(120),
    "storageKey" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attachedAt" TIMESTAMPTZ(3),

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_jobs" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL DEFAULT 'image',
    "provider" VARCHAR(32) NOT NULL,
    "model" VARCHAR(128) NOT NULL,
    "prompt" TEXT NOT NULL,
    "status" "generation_job_status" NOT NULL DEFAULT 'QUEUED',
    "errorCode" VARCHAR(64),
    "attachmentId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "generation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attachments_storageKey_key" ON "attachments"("storageKey");

-- CreateIndex
CREATE INDEX "attachments_userId_createdAt_idx" ON "attachments"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "attachments_messageId_idx" ON "attachments"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "generation_jobs_attachmentId_key" ON "generation_jobs"("attachmentId");

-- CreateIndex
CREATE INDEX "generation_jobs_userId_createdAt_idx" ON "generation_jobs"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "generation_jobs_status_createdAt_idx" ON "generation_jobs"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Row Level Security (ADR-005): deny Supabase Data API access to attachment metadata and jobs.
-- The API connects as the table owner through Prisma, which RLS does not restrict. The image
-- bytes live in a private Storage bucket that only the service-role key can read (ADR-015).
ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "generation_jobs" ENABLE ROW LEVEL SECURITY;
