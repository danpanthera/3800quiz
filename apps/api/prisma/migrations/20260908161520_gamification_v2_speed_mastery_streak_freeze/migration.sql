-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "badge_category" ADD VALUE 'SPEED';
ALTER TYPE "badge_category" ADD VALUE 'MASTERY';
ALTER TYPE "badge_category" ADD VALUE 'SPECIAL';

-- AlterTable
ALTER TABLE "quiz_attempt_answers" ADD COLUMN     "answered_ms" INTEGER;

-- AlterTable
ALTER TABLE "user_progress" ADD COLUMN     "last_streak_freeze_grant_at" TIMESTAMP(3),
ADD COLUMN     "streak_freeze_count" INTEGER NOT NULL DEFAULT 2;
