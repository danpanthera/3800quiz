-- CreateTable: arena_team_members (tạo TRƯỚC khi drop cột cũ để copy dữ liệu không mất)
CREATE TABLE "arena_team_members" (
    "id" TEXT NOT NULL,
    "arena_session_id" TEXT NOT NULL,
    "arena_team_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "arena_team_members_pkey" PRIMARY KEY ("id")
);

-- Migrate dữ liệu: mỗi arena_teams.user_id hiện có trở thành 1 dòng thành viên
-- (đội "chơi đơn" = đội có đúng 1 thành viên) — giữ nguyên joined_at gốc.
INSERT INTO "arena_team_members" ("id", "arena_session_id", "arena_team_id", "user_id", "joined_at")
SELECT gen_random_uuid(), "arena_session_id", "id", "user_id", "joined_at"
FROM "arena_teams"
WHERE "user_id" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "arena_teams" DROP CONSTRAINT "arena_teams_user_id_fkey";

-- DropIndex
DROP INDEX "arena_teams_arena_session_id_user_id_key";

-- AlterTable
ALTER TABLE "arena_teams" DROP COLUMN "user_id";

-- CreateTable
CREATE TABLE "arena_invites" (
    "id" TEXT NOT NULL,
    "arena_session_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "arena_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "arena_invites_arena_session_id_user_id_key" ON "arena_invites"("arena_session_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "arena_team_members_arena_session_id_user_id_key" ON "arena_team_members"("arena_session_id", "user_id");

-- AddForeignKey
ALTER TABLE "arena_invites" ADD CONSTRAINT "arena_invites_arena_session_id_fkey" FOREIGN KEY ("arena_session_id") REFERENCES "arena_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arena_invites" ADD CONSTRAINT "arena_invites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arena_team_members" ADD CONSTRAINT "arena_team_members_arena_team_id_fkey" FOREIGN KEY ("arena_team_id") REFERENCES "arena_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arena_team_members" ADD CONSTRAINT "arena_team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
