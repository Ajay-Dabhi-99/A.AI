-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('USER', 'ADMIN');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "role" "user_role" NOT NULL DEFAULT 'USER';

-- CreateTable
CREATE TABLE "model_registry" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "modelId" VARCHAR(128) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "category" VARCHAR(16) NOT NULL DEFAULT 'text',
    "contextWindow" INTEGER NOT NULL,
    "maxOutputTokens" INTEGER NOT NULL,
    "supportsStreaming" BOOLEAN NOT NULL DEFAULT true,
    "supportsVision" BOOLEAN NOT NULL DEFAULT false,
    "supportsTools" BOOLEAN NOT NULL DEFAULT false,
    "availability" VARCHAR(16) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "inputPricePerMillionUsd" DECIMAL(12,6),
    "outputPricePerMillionUsd" DECIMAL(12,6),
    "verifiedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "model_registry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "model_registry_enabled_sortOrder_idx" ON "model_registry"("enabled", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "model_registry_provider_modelId_key" ON "model_registry"("provider", "modelId");

-- Row Level Security (ADR-005): deny Supabase Data API access to the registry.
-- The API connects as the table owner through Prisma, which RLS does not restrict.
ALTER TABLE "model_registry" ENABLE ROW LEVEL SECURITY;
