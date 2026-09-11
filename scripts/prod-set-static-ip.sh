#!/usr/bin/env bash
# ============================================================================
# 7800Quiz — Đặt IP cho card mạng máy ảo Ubuntu (DEPLOYMENT.md 3.2 + Phụ lục A)
#
# Tạo sẵn để gõ 1 lệnh ngắn qua console Hyper-V Connect, thay vì soạn tay file
# YAML nhiều dòng nhiều ký tự đặc biệt (#, :, [, ], thụt lề) — rất dễ gõ sai
# qua console đó (không dán clipboard được).
#
# 3 cách dùng (chạy bằng sudo):
#   1) IP tĩnh mạng nội bộ (Giai đoạn 3.2) — script ghi nhớ cấu hình này:
#        sudo bash prod-set-static-ip.sh <IP/CIDR> <gateway> <dns[,dns-phụ]> [card-mạng]
#        VD: sudo bash prod-set-static-ip.sh 10.20.1.50/24 10.20.1.1 10.20.1.2,10.20.1.3
#   2) Nhận IP tự động (DHCP) khi cắm Internet tạm để cập nhật (Phụ lục A):
#        sudo bash prod-set-static-ip.sh dhcp
#   3) Quay lại IP tĩnh đã ghi nhớ ở cách 1 (sau khi cắm lại mạng nội bộ):
#        sudo bash prod-set-static-ip.sh
#
# Lấy đúng gateway/DNS THẬT (đừng đoán): trên Windows chạy `ipconfig /all`,
# đọc "Default Gateway"/"DNS Servers" của card mạng nội bộ. Nhiều DNS nối bằng
# dấu phẩy, KHÔNG dấu cách. card-mạng mặc định "eth0".
#
# Script ghi đúng 1 file /etc/netplan/99-prod-static.yaml, tắt mọi file netplan
# khác (đổi tên thành .bak-<giờ>, không xoá — khôi phục được), tắt cloud-init tự
# sinh lại cấu hình mạng, áp dụng, rồi TỰ KIỂM TRA kết quả. Chạy lại vẫn an toàn.
# ============================================================================
set -euo pipefail

if [ "$(id -u)" != 0 ]; then
  echo 'Cần chạy bằng sudo: sudo bash prod-set-static-ip.sh ...' >&2
  exit 1
fi

# Không có đuôi .yaml nên netplan bỏ qua file này.
SAVED=/etc/netplan/prod-static.args
saved_iface() { if [ -f "$SAVED" ]; then awk '{print $4}' "$SAVED"; fi; }

case "${1:-}" in
  dhcp)
    MODE=dhcp
    IFACE="${2:-$(saved_iface)}"
    IFACE="${IFACE:-eth0}"
    ;;
  '')
    if [ ! -f "$SAVED" ]; then
      echo 'Chưa có IP tĩnh nào được ghi nhớ — chạy đủ tham số lần đầu:' >&2
      echo '  sudo bash prod-set-static-ip.sh <IP/CIDR> <gateway> <dns>' >&2
      exit 1
    fi
    MODE=static
    read -r ADDR GATEWAY DNS IFACE < "$SAVED"
    ;;
  *)
    MODE=static
    ADDR="$1"
    GATEWAY="${2:?Thiếu gateway — lấy từ ipconfig /all trên Windows}"
    DNS="${3:?Thiếu DNS — lấy từ ipconfig /all trên Windows, nhiều DNS nối bằng dấu phẩy}"
    IFACE="${4:-eth0}"
    case "$ADDR" in
      */*) ;;
      *) echo "Thiếu tiền tố mạng (VD /24) trong '$ADDR' — sửa lại thành dạng 10.20.1.50/24" >&2; exit 1 ;;
    esac
    ;;
esac

# Kiểm tra trước khi đụng vào gì: script tắt mọi file netplan khác, nên ghi cấu
# hình cho một card không tồn tại sẽ làm máy ảo mất mạng hoàn toàn.
if ! ip link show "$IFACE" >/dev/null 2>&1; then
  echo "Không thấy card mạng '$IFACE'. Card hiện có: $(ls /sys/class/net | tr '\n' ' ')" >&2
  exit 1
fi

log() { echo -e "\033[36m[prod-set-static-ip]\033[0m $1"; }
# Không dùng grep -q/awk exit sau dấu | : dưới pipefail, lệnh đọc thoát sớm có
# thể làm lệnh phía trước dính SIGPIPE, cả script thoát oan.
has_addr() { ip -4 -o addr show dev "$IFACE" | grep -F " $1 " >/dev/null; }
dhcp_addr() { ip -4 -o addr show dev "$IFACE" | awk '/ dynamic /{a=$4} END{print a}'; }

# Netplan GỘP cấu hình từ mọi file *.yaml, file sau (theo tên) thắng file trước.
# Dùng đúng 1 file tên "99-" và tắt mọi file khác — tránh "dhcp4: true" còn sót
# từ lúc cài Ubuntu sống song song với IP tĩnh.
FILE=/etc/netplan/99-prod-static.yaml
TS="$(date +%Y%m%d%H%M%S)"

shopt -s nullglob
for f in /etc/netplan/*.yaml; do
  [ "$f" = "$FILE" ] && continue
  mv "$f" "${f}.bak-${TS}"
  log "Đã tắt file netplan khác (đổi tên, không xoá): $f → ${f}.bak-${TS}"
done
shopt -u nullglob
[ -f "$FILE" ] && cp "$FILE" "${FILE}.bak-${TS}"

if [ "$MODE" = static ]; then
  cat > "$FILE" <<YAML
network:
  version: 2
  ethernets:
    ${IFACE}:
      dhcp4: false
      addresses: [${ADDR}]
      routes:
        - to: default
          via: ${GATEWAY}
      nameservers:
        addresses: [${DNS}]
YAML
else
  cat > "$FILE" <<YAML
network:
  version: 2
  ethernets:
    ${IFACE}:
      dhcp4: true
YAML
fi
chmod 600 "$FILE"
log "Đã ghi $FILE:"
cat "$FILE"

# cloud-init (có sẵn trên Ubuntu Server) có thể sinh lại 50-cloud-init.yaml ở
# lần khởi động sau — tắt đúng theo cách chính file đó hướng dẫn.
if [ -d /etc/cloud/cloud.cfg.d ]; then
  echo 'network: {config: disabled}' > /etc/cloud/cloud.cfg.d/99-disable-network-config.cfg
fi

log 'Đang áp dụng (netplan apply)...'
netplan apply

if [ "$MODE" = static ]; then
  for _ in $(seq 10); do
    has_addr "$ADDR" && break
    sleep 1
  done
  if ! has_addr "$ADDR"; then
    ip addr show "$IFACE"
    echo "LỖI: card $IFACE chưa nhận $ADDR sau khi áp dụng — chụp phần in ở trên để chẩn đoán." >&2
    exit 1
  fi
  echo "$ADDR $GATEWAY $DNS $IFACE" > "$SAVED"
  # Máy ảo Hyper-V không thấy "rút dây" khi đổi dây ở máy chủ thật (switch ảo
  # vẫn lên), nên IP DHCP cũ có thể còn bám trên card — xoá hẳn.
  for old in $(ip -4 -o addr show dev "$IFACE" | awk '{print $4}' | grep -vxF "$ADDR" || true); do
    ip addr del "$old" dev "$IFACE"
    log "Đã xoá IP cũ còn sót trên $IFACE: $old"
  done
else
  log 'Đang chờ nhận IP từ DHCP (tối đa 30 giây)...'
  for _ in $(seq 30); do
    [ -n "$(dhcp_addr)" ] && break
    sleep 1
  done
  if [ -z "$(dhcp_addr)" ]; then
    ip addr show "$IFACE"
    echo 'LỖI: chưa nhận được IP từ DHCP — kiểm tra dây Internet đã cắm đúng card của máy ảo chưa.' >&2
    exit 1
  fi
  for old in $(ip -4 -o addr show dev "$IFACE" | awk '!/ dynamic /{print $4}'); do
    ip addr del "$old" dev "$IFACE"
    log "Đã gỡ IP tĩnh cũ trên $IFACE: $old"
  done
fi

echo ''
log "Card $IFACE hiện tại:"
ip -4 addr show "$IFACE"
log 'Bảng định tuyến:'
ip route
echo ''
if [ "$MODE" = static ]; then
  if ping -c 2 -W 2 "$GATEWAY" >/dev/null 2>&1; then
    log "OK — ping được gateway $GATEWAY."
  else
    echo "CẢNH BÁO: chưa ping được gateway $GATEWAY. Kiểm tra lại đúng gateway (ipconfig /all trên"
    echo "Windows) và dây mạng. Một số router cố ý chặn ping — nếu máy khác trong LAN ping được"
    echo "${ADDR%/*} thì bỏ qua cảnh báo này."
  fi
  echo ''
  echo "Đã ghi nhớ cấu hình này — lần sau quay lại IP tĩnh chỉ cần: sudo bash $0"
else
  if curl -fsS -o /dev/null -m 15 https://github.com; then
    log 'OK — đã ra được Internet (kết nối được GitHub).'
  else
    echo 'CẢNH BÁO: có IP nhưng chưa kết nối được GitHub — kiểm tra nguồn Internet tạm.'
  fi
  echo ''
  echo 'Cập nhật xong: rút dây Internet, cắm lại mạng nội bộ, rồi chạy (không tham số):'
  echo "  sudo bash $0"
fi
