/*
  Cảnh báo:

  - Sắp xoá cột `fcm_token` khỏi bảng `users`. Toàn bộ dữ liệu trong cột này sẽ bị mất.
  - Sắp xoá bảng `sync_outbox`. Nếu bảng chưa rỗng, toàn bộ dữ liệu trong đó sẽ bị mất.

*/
-- AlterTable
ALTER TABLE "users" DROP COLUMN "fcm_token";

-- DropTable
DROP TABLE "sync_outbox";

-- DropEnum
DROP TYPE "sync_status";
