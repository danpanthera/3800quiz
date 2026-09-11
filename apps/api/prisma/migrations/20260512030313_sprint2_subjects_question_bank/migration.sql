-- AlterTable
ALTER TABLE "questions" ADD COLUMN     "explanation" TEXT,
ADD COLUMN     "is_bank" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "subject_id" TEXT,
ALTER COLUMN "quiz_id" DROP NOT NULL,
ALTER COLUMN "order_index" SET DEFAULT 0;

-- CreateTable
CREATE TABLE "subjects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subjects_name_key" ON "subjects"("name");

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
