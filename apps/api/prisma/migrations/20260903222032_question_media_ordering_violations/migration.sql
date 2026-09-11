-- CreateEnum
CREATE TYPE "attempt_violation_type" AS ENUM ('TAB_HIDDEN', 'FULLSCREEN_EXIT', 'COPY_ATTEMPT');

-- AlterEnum
ALTER TYPE "question_type" ADD VALUE 'ORDERING';

-- AlterTable
ALTER TABLE "questions" ADD COLUMN     "image_url" TEXT;

-- AlterTable
ALTER TABLE "quiz_attempts" ADD COLUMN     "violation_count" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "attempt_violations" (
    "id" TEXT NOT NULL,
    "attempt_id" TEXT NOT NULL,
    "type" "attempt_violation_type" NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attempt_violations_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "attempt_violations" ADD CONSTRAINT "attempt_violations_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "quiz_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

