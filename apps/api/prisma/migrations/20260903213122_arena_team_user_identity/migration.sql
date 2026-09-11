-- AlterTable
ALTER TABLE "arena_teams" ADD COLUMN     "user_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "arena_teams_arena_session_id_user_id_key" ON "arena_teams"("arena_session_id", "user_id");

-- AddForeignKey
ALTER TABLE "arena_teams" ADD CONSTRAINT "arena_teams_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

