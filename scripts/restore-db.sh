#!/usr/bin/env bash
# ============================================================================
# 3800Quiz — Phục hồi PostgreSQL từ bản sao lưu (chạy TRONG VM Ubuntu)
#
# ⚠ THAO TÁC PHÁ HUỶ: xoá sạch dữ liệu hiện tại rồi nạp lại từ file dump.
#
# Trước khi chạy, dừng ứng dụng (giữ Postgres chạy):
#   docker compose -f docker-compose.prod.yml --env-file .env.prod stop api web
# Sau khi xong:
#   docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
#
# Dùng:
#   bash scripts/restore-db.sh /var/backups/3800quiz/quiz3800_2026-09-05_0200.dump
# ============================================================================
set -euo pipefail

DUMP_FILE="${1:?Cách dùng: restore-db.sh <đường-dẫn-file-dump>}"
CONTAINER="${CONTAINER:-quiz3800_db}"

[ -f "$DUMP_FILE" ] || { echo "Không tìm thấy file: $DUMP_FILE"; exit 1; }

pg_user=$(docker exec "$CONTAINER" printenv POSTGRES_USER | tr -d '\r')
pg_db=$(docker exec "$CONTAINER" printenv POSTGRES_DB | tr -d '\r')

echo -e "\033[31mSẽ GHI ĐÈ toàn bộ cơ sở dữ liệu '$pg_db' trong container '$CONTAINER'\033[0m"
echo "Nguồn: $DUMP_FILE"
read -rp "Gõ chính xác YES để tiếp tục: " tra_loi
[ "$tra_loi" = "YES" ] || { echo "Đã huỷ."; exit 1; }

# Chốt chặn cuối: chụp lại trạng thái hiện tại trước khi ghi đè
anh_chup="/tmp/pre_restore_$(date +%Y%m%d_%H%M%S).dump"
docker exec "$CONTAINER" pg_dump -U "$pg_user" -d "$pg_db" -Fc -f "$anh_chup"
docker cp "${CONTAINER}:${anh_chup}" "$(dirname "$DUMP_FILE")/pre_restore_safety.dump"
docker exec "$CONTAINER" rm -f "$anh_chup"
echo -e "\033[33mĐã lưu ảnh chụp an toàn: pre_restore_safety.dump\033[0m"

docker cp "$DUMP_FILE" "${CONTAINER}:/tmp/restore.dump"

# --clean --if-exists xoá đối tượng cũ trước khi tạo lại; nhờ đó bảng
# _prisma_migrations cũng về đúng trạng thái của bản dump, khớp với mã nguồn
# được đưa về cùng thời điểm.
docker exec "$CONTAINER" pg_restore -U "$pg_user" -d "$pg_db" --clean --if-exists --no-owner -v /tmp/restore.dump
docker exec "$CONTAINER" rm -f /tmp/restore.dump

echo -e "\033[32mPhục hồi xong. Chạy tiếp:\033[0m"
echo "  docker compose -f docker-compose.prod.yml --env-file .env.prod up -d"
