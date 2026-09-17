-- MODEL-062: pin saved chats to the top of the sidebar.
-- No new tables: Row Level Security on "conversations" was enabled in Phase 2.

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "pinnedAt" TIMESTAMPTZ(3);
