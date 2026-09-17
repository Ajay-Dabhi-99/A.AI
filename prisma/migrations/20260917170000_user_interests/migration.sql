-- MODEL-066: topics a user picks after signing in.
-- No new tables: Row Level Security on "users" was enabled in Phase 1.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "interests" VARCHAR(40)[] DEFAULT ARRAY[]::VARCHAR(40)[],
ADD COLUMN     "interestsSetAt" TIMESTAMPTZ(3);
