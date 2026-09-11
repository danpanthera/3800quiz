#!/usr/bin/env bash
# ============================================================================
# 3800Quiz — Đăng ký lịch sao lưu tự động (cron, chạy TRONG VM Ubuntu)
# Chạy MỘT LẦN, bằng đúng user sẽ chạy Docker (user đã `usermod -aG docker`
# ở Giai đoạn 2 — KHÔNG cần root/sudo nếu user đó đã thuộc nhóm docker):
#   bash scripts/register-backup-cron.sh
# ============================================================================
set -euo pipefail

THU_MUC_DU_AN="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DONG_CRON="0 2 * * * /usr/bin/env bash $THU_MUC_DU_AN/scripts/backup-db.sh >> /var/backups/3800quiz/cron.log 2>&1"

( crontab -l 2>/dev/null | grep -vF "$THU_MUC_DU_AN/scripts/backup-db.sh" ; echo "$DONG_CRON" ) | crontab -

echo "Đã đăng ký cron chạy hằng ngày lúc 02:00. Chạy thử ngay để xác nhận..."
bash "$THU_MUC_DU_AN/scripts/backup-db.sh"
tail -n 20 /var/backups/3800quiz/backup.log
