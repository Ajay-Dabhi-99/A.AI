-- MODEL-060: optional profile details (first name, last name, phone).
-- No new tables: Row Level Security on "users" was enabled in Phase 1.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "firstName" VARCHAR(60),
ADD COLUMN     "lastName" VARCHAR(60),
ADD COLUMN     "phone" VARCHAR(24);
