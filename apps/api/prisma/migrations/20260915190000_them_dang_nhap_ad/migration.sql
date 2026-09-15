-- CreateEnum
CREATE TYPE "auth_source" AS ENUM ('LOCAL', 'AD');

-- AlterTable
ALTER TABLE "can_bo" ADD COLUMN     "dang_nhap_bang_ad" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "auth_source" "auth_source" NOT NULL DEFAULT 'LOCAL';
