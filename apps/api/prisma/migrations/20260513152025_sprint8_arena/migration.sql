-- CreateEnum
CREATE TYPE "arena_status" AS ENUM ('LOBBY', 'RUNNING', 'FINISHED');

-- CreateEnum
CREATE TYPE "arena_host_mode" AS ENUM ('MANUAL', 'AUTO');

-- CreateEnum
CREATE TYPE "arena_round_status" AS ENUM ('PENDING', 'ACTIVE', 'REVEALED');

-- AlterTable
ALTER TABLE "assignments" ADD COLUMN     "can_bo_id" TEXT;

-- CreateTable
CREATE TABLE "arena_sessions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quiz_id" TEXT NOT NULL,
    "join_code" TEXT NOT NULL,
    "host_mode" "arena_host_mode" NOT NULL DEFAULT 'MANUAL',
    "auto_advance_sec" INTEGER NOT NULL DEFAULT 10,
    "status" "arena_status" NOT NULL DEFAULT 'LOBBY',
    "current_round_order" INTEGER NOT NULL DEFAULT 0,
    "points_for_rank" JSONB NOT NULL DEFAULT '[10,7,5,3,2,2,2,2,2]',
    "penalty_wrong" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "arena_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arena_teams" (
    "id" TEXT NOT NULL,
    "arena_session_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "rank" INTEGER,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "arena_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arena_rounds" (
    "id" TEXT NOT NULL,
    "arena_session_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "status" "arena_round_status" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMP(3),
    "revealed_at" TIMESTAMP(3),

    CONSTRAINT "arena_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arena_buzzes" (
    "id" TEXT NOT NULL,
    "arena_round_id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "selected_option_ids" JSONB NOT NULL,
    "answered_at" TIMESTAMP(3) NOT NULL,
    "is_correct" BOOLEAN NOT NULL,
    "points_awarded" INTEGER NOT NULL DEFAULT 0,
    "correct_rank" INTEGER,

    CONSTRAINT "arena_buzzes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "can_bo" (
    "id" TEXT NOT NULL,
    "cb_code" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "username" TEXT,
    "email" TEXT,
    "phone_number" TEXT,
    "user_ad" TEXT,
    "user_ipcas" TEXT,
    "ma_cbtd" TEXT,
    "cccd" TEXT,
    "ngay_cap_cmt" TEXT,
    "noi_cap_cmt" TEXT,
    "ngay_sinh" TIMESTAMP(3),
    "gioi_tinh" TEXT,
    "department_id" TEXT,
    "position" TEXT,
    "is_party_member" BOOLEAN NOT NULL DEFAULT false,
    "is_union_member" BOOLEAN NOT NULL DEFAULT false,
    "is_youth_union_member" BOOLEAN NOT NULL DEFAULT false,
    "is_it_staff" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "can_bo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "arena_sessions_join_code_key" ON "arena_sessions"("join_code");

-- CreateIndex
CREATE UNIQUE INDEX "arena_rounds_arena_session_id_order_key" ON "arena_rounds"("arena_session_id", "order");

-- CreateIndex
CREATE UNIQUE INDEX "arena_buzzes_arena_round_id_team_id_key" ON "arena_buzzes"("arena_round_id", "team_id");

-- CreateIndex
CREATE UNIQUE INDEX "can_bo_cb_code_key" ON "can_bo"("cb_code");

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_can_bo_id_fkey" FOREIGN KEY ("can_bo_id") REFERENCES "can_bo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arena_sessions" ADD CONSTRAINT "arena_sessions_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arena_teams" ADD CONSTRAINT "arena_teams_arena_session_id_fkey" FOREIGN KEY ("arena_session_id") REFERENCES "arena_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arena_rounds" ADD CONSTRAINT "arena_rounds_arena_session_id_fkey" FOREIGN KEY ("arena_session_id") REFERENCES "arena_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arena_rounds" ADD CONSTRAINT "arena_rounds_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arena_buzzes" ADD CONSTRAINT "arena_buzzes_arena_round_id_fkey" FOREIGN KEY ("arena_round_id") REFERENCES "arena_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arena_buzzes" ADD CONSTRAINT "arena_buzzes_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "arena_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "can_bo" ADD CONSTRAINT "can_bo_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
