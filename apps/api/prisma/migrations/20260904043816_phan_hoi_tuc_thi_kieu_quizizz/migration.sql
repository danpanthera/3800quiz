-- AlterTable
ALTER TABLE "quiz_attempt_answers" ADD COLUMN     "is_correct" BOOLEAN,
ADD COLUMN     "locked_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "quizzes" ADD COLUMN     "instant_feedback" BOOLEAN NOT NULL DEFAULT true;
