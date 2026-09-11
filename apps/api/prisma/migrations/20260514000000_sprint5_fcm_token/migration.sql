-- Sprint 5: Thêm cột fcm_token vào bảng users để hỗ trợ push notification
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "fcm_token" TEXT;
