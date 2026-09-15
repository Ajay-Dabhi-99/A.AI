-- CreateTable
CREATE TABLE "comparisons" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "prompt" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comparisons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comparison_runs" (
    "id" UUID NOT NULL,
    "comparisonId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "model" VARCHAR(128) NOT NULL,
    "status" "run_status" NOT NULL DEFAULT 'RUNNING',
    "content" TEXT,
    "ttftMs" INTEGER,
    "latencyMs" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "usageSource" VARCHAR(16),
    "estimatedCostUsd" DECIMAL(12,6),
    "errorCode" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "comparison_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "comparisons_userId_createdAt_idx" ON "comparisons"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "comparison_runs_comparisonId_position_idx" ON "comparison_runs"("comparisonId", "position");

-- AddForeignKey
ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comparison_runs" ADD CONSTRAINT "comparison_runs_comparisonId_fkey" FOREIGN KEY ("comparisonId") REFERENCES "comparisons"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row Level Security (ADR-005): deny Supabase Data API access to comparison data.
-- The API connects as the table owner through Prisma, which RLS does not restrict.
ALTER TABLE "comparisons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "comparison_runs" ENABLE ROW LEVEL SECURITY;
