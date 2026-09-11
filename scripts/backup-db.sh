#!/usr/bin/env bash
# ============================================================================
# 3800Quiz — Sao lưu PostgreSQL tự động (chạy TRONG VM Ubuntu, qua cron)
#
# Chạy tay:  bash scripts/backup-db.sh
# Đặt lịch:  xem scripts/register-backup-cron.sh
#
# ⚠ Bản sao lưu chứa dữ liệu nhân sự thật (CCCD, ngày sinh, số điện thoại) nên
#   thư mục lưu phải nằm trong phạm vi kiểm soát truy cập của ngân hàng.
# ============================================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/3800quiz}"
CONTAINER="${CONTAINER:-quiz3800_db}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"          # giữ bản hằng ngày trong 14 ngày
RETAIN_MONTHLY_DAYS="${RETAIN_MONTHLY_DAYS:-365}"  # giữ bản ngày mùng 1 trong 12 tháng

nhan=$(date +%Y-%m-%d_%H%M)
if [ "$(date +%d)" = "01" ]; then tien_to="monthly_quiz3800"; else tien_to="quiz3800"; fi
ten_file="${tien_to}_${nhan}.dump"

mkdir -p "$BACKUP_DIR"
file_log="$BACKUP_DIR/backup.log"

ghi_log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$file_log"
}

loi() {
  ghi_log "LỖI: $1"
  # Ghi vào syslog để hệ thống giám sát của phòng CNTT bắt được
  logger -t 3800quiz-backup "Sao lưu 3800Quiz thất bại: $1" || true
  exit 1
}

ghi_log "=== Bắt đầu sao lưu ==="

pg_user=$(docker exec "$CONTAINER" printenv POSTGRES_USER | tr -d '\r')
pg_db=$(docker exec "$CONTAINER" printenv POSTGRES_DB | tr -d '\r')
[ -n "$pg_user" ] || loi "Không đọc được POSTGRES_USER từ container $CONTAINER"
ghi_log "User=$pg_user  DB=$pg_db"

file_trong_container="/tmp/$ten_file"

# -Fc = định dạng custom (đã nén sẵn, phục hồi chọn lọc được bằng pg_restore)
# --no-owner giúp phục hồi sang cụm máy chủ khác dễ hơn
docker exec "$CONTAINER" pg_dump -U "$pg_user" -d "$pg_db" -Fc -Z 6 --no-owner -f "$file_trong_container" \
  || loi "pg_dump thất bại"

file_dich="$BACKUP_DIR/$ten_file"
docker cp "${CONTAINER}:${file_trong_container}" "$file_dich" || loi "Không sao chép được file sao lưu ra khỏi container"
docker exec "$CONTAINER" rm -f "$file_trong_container"

# Kiểm tra tính hợp lệ: file phải đủ lớn và pg_restore đọc được mục lục
kich_thuoc=$(stat -c%s "$file_dich" 2>/dev/null || stat -f%z "$file_dich")
[ "$kich_thuoc" -ge 10240 ] || loi "File sao lưu quá nhỏ ($kich_thuoc byte) — nghi ngờ bị hỏng"

docker cp "$file_dich" "${CONTAINER}:/tmp/verify.dump"
if docker exec "$CONTAINER" pg_restore --list /tmp/verify.dump >/dev/null 2>&1; then hop_le=1; else hop_le=0; fi
docker exec "$CONTAINER" rm -f /tmp/verify.dump
[ "$hop_le" = "1" ] || loi "pg_restore --list không đọc được file — FILE HỎNG"

ghi_log "OK: $ten_file ($((kich_thuoc / 1024 / 1024)) MB) — đã xác minh bằng pg_restore --list"

# ── Dọn theo chính sách lưu trữ ────────────────────────────────────────────
find "$BACKUP_DIR" -maxdepth 1 -name 'quiz3800_*.dump' -mtime +"$RETAIN_DAYS" -print 2>/dev/null | while read -r f; do
  ghi_log "Xoá bản cũ: $(basename "$f")"
  rm -f "$f"
done
find "$BACKUP_DIR" -maxdepth 1 -name 'monthly_quiz3800_*.dump' -mtime +"$RETAIN_MONTHLY_DAYS" -print 2>/dev/null | while read -r f; do
  ghi_log "Xoá bản tháng cũ: $(basename "$f")"
  rm -f "$f"
done

# ── Sao chép ra kho ngoài ────────────────────────────────────────────────
# Bản sao lưu nằm cùng máy chủ thì chưa phải là bản sao lưu. Bỏ chú thích và
# điền đường dẫn kho lưu trữ của ngân hàng (ổ mạng nội bộ đã mount sẵn, ví dụ
# qua fstab/autofs — máy chủ này không có Internet nên không dùng được kho
# lưu trữ đám mây):
# kho_ngoai=/mnt/backup-noibo/3800quiz
# cp "$file_dich" "$kho_ngoai/" && ghi_log "Đã sao chép sang $kho_ngoai"

ghi_log "=== Hoàn tất ==="
