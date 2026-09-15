-- AlterTable
ALTER TABLE "model_runs" ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "fallbackReason" VARCHAR(64),
ADD COLUMN     "requestedModel" VARCHAR(128),
ADD COLUMN     "requestedProvider" VARCHAR(32);

