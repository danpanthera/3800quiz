-- Đồng hồ do server làm chủ + đo độ trễ mạng cho Đấu trường.
-- Sửa tay từ bản Prisma tự sinh: thêm USING ... AT TIME ZONE 'UTC' cho mọi
-- ALTER COLUMN đổi sang TIMESTAMPTZ (đúng tiền lệ 20260903133000_attempt_timestamptz),
-- và tách received_at thành ADD nullable → backfill → SET NOT NULL vì bảng
-- arena_buzzes đã có dữ liệu cũ.

-- CreateEnum
CREATE TYPE "arena_reveal_reason" AS ENUM ('HOST', 'DEADLINE', 'SKIPPED');

-- AlterTable arena_buzzes
ALTER TABLE "arena_buzzes"
  ADD COLUMN     "latency_ms" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN     "raw_response_ms" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN     "received_at" TIMESTAMPTZ(3),
  ADD COLUMN     "response_ms" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN     "score_after" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN     "score_before" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN     "speed_rank" INTEGER,
  ALTER COLUMN "answered_at" TYPE TIMESTAMPTZ(3) USING "answered_at" AT TIME ZONE 'UTC';

-- Buzz cũ chưa có mốc thô riêng: lấy answered_at làm mốc nhận, response_ms/
-- rawResponseMs/latencyMs giữ mặc định 0 vì không thể tái tạo (chưa từng lưu
-- độ lệch chính xác trước đây).
UPDATE "arena_buzzes" SET "received_at" = "answered_at" WHERE "received_at" IS NULL;

ALTER TABLE "arena_buzzes" ALTER COLUMN "received_at" SET NOT NULL;

-- AlterTable arena_invites
ALTER TABLE "arena_invites"
  ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

-- AlterTable arena_rounds
ALTER TABLE "arena_rounds"
  ADD COLUMN     "deadline_at" TIMESTAMPTZ(3),
  ADD COLUMN     "reveal_reason" "arena_reveal_reason",
  ALTER COLUMN "started_at" TYPE TIMESTAMPTZ(3) USING "started_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "revealed_at" TYPE TIMESTAMPTZ(3) USING "revealed_at" AT TIME ZONE 'UTC';

-- AlterTable arena_sessions
ALTER TABLE "arena_sessions"
  ADD COLUMN     "question_duration_sec" INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN     "reveal_pause_sec" INTEGER NOT NULL DEFAULT 5,
  ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at" TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- Giữ nguyên hành vi phòng AUTO đang tồn tại: thời gian trả lời mỗi câu vẫn là
-- giá trị auto_advance_sec MC đã cấu hình, không đột ngột đổi thành 20 giây.
UPDATE "arena_sessions" SET "question_duration_sec" = "auto_advance_sec";

-- AlterTable arena_team_members
ALTER TABLE "arena_team_members"
  ALTER COLUMN "joined_at" TYPE TIMESTAMPTZ(3) USING "joined_at" AT TIME ZONE 'UTC';

-- AlterTable arena_teams
ALTER TABLE "arena_teams"
  ADD COLUMN     "correct_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN     "total_answer_ms" INTEGER NOT NULL DEFAULT 0,
  ALTER COLUMN "joined_at" TYPE TIMESTAMPTZ(3) USING "joined_at" AT TIME ZONE 'UTC';
