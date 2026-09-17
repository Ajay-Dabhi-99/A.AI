-- MODEL-070: public read-only chat snapshots.
-- New table: Row Level Security is enabled below (ADR-005). The API reads it with the
-- service connection; no Supabase Data API policy is granted, so it is not publicly exposed.

-- CreateTable
CREATE TABLE "conversation_shares" (
    "id" UUID NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "conversationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "messages" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conversation_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversation_shares_token_key" ON "conversation_shares"("token");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_shares_conversationId_key" ON "conversation_shares"("conversationId");

-- CreateIndex
CREATE INDEX "conversation_shares_userId_idx" ON "conversation_shares"("userId");

-- AddForeignKey
ALTER TABLE "conversation_shares" ADD CONSTRAINT "conversation_shares_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_shares" ADD CONSTRAINT "conversation_shares_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row Level Security
ALTER TABLE "conversation_shares" ENABLE ROW LEVEL SECURITY;
