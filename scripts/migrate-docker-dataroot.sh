#!/usr/bin/env bash
# ============================================================================
# 7800Quiz — Chuyển toàn bộ dữ liệu Docker (postgres_data, caddy_data, images...)
# sang ổ đĩa mới gắn qua SCSI controller của máy ảo.
#
# Lý do: ổ hệ điều hành hiện tại của máy ảo gắn qua IDE controller (Generation 1
# VM) — Microsoft khuyến cáo IDE chỉ nên dùng cho ổ hệ điều hành, KHÔNG dùng
# cho dữ liệu (không có nhiều kênh song song như SCSI). Toàn bộ dữ liệu Postgres
# (điểm thi, tài khoản...) hiện đang nằm trên đúng ổ IDE đó.
#
# CHUẨN BỊ TRƯỚC (bên Windows, PowerShell qua RDP — KHÔNG phải trong máy ảo):
#   New-VHD -Path "D:\quiz\quiz7800-host\pgdata-scsi.vhdx" -SizeBytes 50GB -Fixed
#   Add-VMHardDiskDrive -VMName quiz7800-host -ControllerType SCSI -Path "D:\quiz\quiz7800-host\pgdata-scsi.vhdx"
# (làm được ngay cả khi máy ảo đang chạy, không cần tắt máy — SCSI hỗ trợ gắn
# nóng. Đổi dung lượng 50GB nếu cần, xem gợi ý đo dung lượng hiện tại bên dưới)
#
# Dùng (trong máy ảo Ubuntu, sudo) — CHỈ chạy sau khi đã gắn ổ đĩa mới ở bước
# trên và xác nhận đúng tên ổ bằng `lsblk` (KHÔNG đoán, ổ sai tên sẽ format
# nhầm ổ hệ điều hành):
#   sudo bash migrate-docker-dataroot.sh /dev/sdX
#
# Script tạm dừng Docker vài phút (tuỳ dung lượng dữ liệu), sao chép dữ liệu
# sang ổ mới, đổi hướng Docker sang đó, rồi khởi động lại. Bản dữ liệu cũ được
# ĐỔI TÊN (không xoá) — có thể quay lại nếu có sự cố, xem hướng dẫn cuối script.
# ============================================================================
set -euo pipefail

if [ "$(id -u)" != 0 ]; then
  echo 'Cần chạy bằng sudo: sudo bash migrate-docker-dataroot.sh /dev/sdX' >&2
  exit 1
fi

DEV="${1:?Thiếu tên ổ đĩa mới, VD /dev/sdb — kiểm bằng lsblk trước, đừng đoán}"
MOUNT=/mnt/docker-data
NEW_ROOT="$MOUNT/docker"

log() { echo -e "\033[36m[migrate-docker-dataroot]\033[0m $1"; }

[ -b "$DEV" ] || { echo "Không thấy ổ đĩa '$DEV'. Ổ đang có: $(lsblk -dno NAME | sed 's#^#/dev/#' | tr '\n' ' ')" >&2; exit 1; }
if lsblk -no MOUNTPOINT "$DEV" 2>/dev/null | grep -q .; then
  echo "'$DEV' đang được mount ở đâu đó — dừng lại, kiểm tra lại bằng lsblk trước khi chạy tiếp" >&2
  exit 1
fi
# Tên /dev/sdX KHÔNG cố định — tuỳ máy, ổ hệ điều hành có thể ra /dev/sda HAY
# /dev/sdb tuỳ thứ tự Linux dò thấy lúc khởi động, không đảm bảo ổ mới luôn là
# ký tự sau ổ cũ. Ổ SCSI mới gắn phải HOÀN TOÀN TRỐNG (không phân vùng nào) —
# đây là lớp chặn cuối cùng trước khi lỡ format nhầm ổ hệ điều hành đang chạy
# (có /boot, LVM gắn /).
PARTS="$(lsblk -no NAME "$DEV" | wc -l)"
if [ "$PARTS" -gt 1 ]; then
  echo "LỖI: '$DEV' đã có $((PARTS - 1)) phân vùng bên trong — đây không phải ổ mới trống." >&2
  lsblk "$DEV" >&2
  echo "Ổ SCSI mới gắn phải trống hoàn toàn, không có phân vùng nào. Rất có thể '$DEV'" >&2
  echo "chính là ổ hệ điều hành đang chạy — kiểm tra lại toàn bộ \`lsblk\`, tìm đúng ổ" >&2
  echo "KHÔNG có dòng nào ở cột MOUNTPOINTS và KHÔNG có phân vùng con." >&2
  exit 1
fi

if ! blkid "$DEV" >/dev/null 2>&1; then
  log "Ổ '$DEV' chưa có filesystem."
  lsblk "$DEV"
  read -r -p "Gõ đúng chữ XOA để xác nhận định dạng ext4 lên $DEV (MẤT MỌI DỮ LIỆU CŨ TRÊN Ổ NÀY NẾU CÓ): " CONFIRM
  [ "$CONFIRM" = "XOA" ] || { echo "Huỷ — không có gì bị đụng vào." >&2; exit 1; }
  mkfs.ext4 -L docker-data "$DEV"
else
  log "Ổ '$DEV' đã có filesystem sẵn — dùng nguyên, không format lại."
fi

mkdir -p "$MOUNT"
UUID="$(blkid -s UUID -o value "$DEV")"
grep -q "$UUID" /etc/fstab 2>/dev/null || echo "UUID=$UUID $MOUNT ext4 defaults 0 2" >> /etc/fstab
mountpoint -q "$MOUNT" || mount "$MOUNT"
log "Đã mount $DEV vào $MOUNT (đã ghi /etc/fstab để tự mount lại sau khi khởi động lại máy)."

FREE_KB=$(df --output=avail "$MOUNT" | tail -1)
NEED_KB=$(du -sk /var/lib/docker | cut -f1)
if [ "$FREE_KB" -lt "$NEED_KB" ]; then
  echo "LỖI: ổ mới còn trống $((FREE_KB/1024))MB, cần ít nhất $((NEED_KB/1024))MB để sao chép /var/lib/docker. Tạo ổ lớn hơn." >&2
  exit 1
fi
log "Đủ dung lượng: cần ~$((NEED_KB/1024))MB, ổ mới còn trống $((FREE_KB/1024))MB."

log 'Đang dừng Docker (dịch vụ tạm gián đoạn vài phút)...'
systemctl stop docker docker.socket

log "Đang sao chép /var/lib/docker sang $NEW_ROOT (giữ nguyên bản cũ làm dự phòng, không xoá)..."
mkdir -p "$NEW_ROOT"
rsync -aHAX --info=progress2 /var/lib/docker/ "$NEW_ROOT/"

if [ -s /etc/docker/daemon.json ] && [ "$(tr -d '[:space:]' < /etc/docker/daemon.json)" != '{}' ]; then
  echo "LỖI: /etc/docker/daemon.json đang có cấu hình khác — không tự động sửa để tránh làm hỏng" >&2
  echo "cấu hình đã có. Tự thêm dòng sau vào file đó (giữ nguyên các dòng khác) rồi chạy lại:" >&2
  echo "  \"data-root\": \"$NEW_ROOT\"" >&2
  systemctl start docker
  exit 1
fi
cat > /etc/docker/daemon.json <<JSON
{
  "data-root": "$NEW_ROOT"
}
JSON

TS="$(date +%Y%m%d%H%M%S)"
mv /var/lib/docker "/var/lib/docker.bak-$TS"
log "Đã đổi tên dữ liệu cũ thành /var/lib/docker.bak-$TS (chưa xoá)."

log 'Đang khởi động lại Docker...'
systemctl start docker
sleep 5

log 'Kiểm tra Docker đã dùng đúng thư mục mới:'
docker info --format 'DockerRootDir hiện tại: {{.DockerRootDir}}'

log 'Đang chờ các container tự khởi động lại theo restart policy (tối đa 60 giây)...'
for _ in $(seq 60); do
  RUNNING=$(docker ps --format '{{.Names}}' | wc -l)
  [ "$RUNNING" -ge 4 ] && break
  sleep 1
done
docker ps

echo ''
echo '=== Kiểm tra tiếp bằng tay ==='
echo 'curl -s http://127.0.0.1:8080/api/health   # phải trả {"status":"ok",...}'
echo 'Đăng nhập thử qua trình duyệt, xác nhận dữ liệu vẫn còn đầy đủ.'
echo ''
echo "Nếu MỌI THỨ ổn định vài ngày, xoá bản dự phòng để lấy lại dung lượng ổ cũ:"
echo "  sudo rm -rf /var/lib/docker.bak-$TS"
echo ''
echo 'Nếu có SỰ CỐ ngay bây giờ, khôi phục lại như cũ:'
echo "  sudo systemctl stop docker"
echo "  sudo rm -f /etc/docker/daemon.json"
echo "  sudo rm -rf $NEW_ROOT"
echo "  sudo mv /var/lib/docker.bak-$TS /var/lib/docker"
echo "  sudo systemctl start docker"
