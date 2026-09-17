-- MODEL-069: personal instructions added to every chat.
-- No new tables: Row Level Security on "users" was enabled in Phase 1.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "instructionsAbout" VARCHAR(1500),
ADD COLUMN     "instructionsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "instructionsStyle" VARCHAR(1500);
