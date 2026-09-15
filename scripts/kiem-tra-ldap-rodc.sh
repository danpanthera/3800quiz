#!/usr/bin/env bash
# ============================================================================
# 3800Quiz — Dò cổng LDAP trên máy RODC và kiểm tra đường mạng tới nó
#
# Chạy TRONG máy ảo Ubuntu của PROD:
#   bash scripts/kiem-tra-ldap-rodc.sh
#
# Đổi máy chủ đích nếu cần. Tên máy "3800-RODC-01" và IP 10.73.0.11 đã xác
# nhận thật (Sếp, 2026-09-15) — mặc định dưới đây khớp đúng, không cần đặt lại
# trừ khi có gì đổi:
#   RODC_IP=10.73.0.11 RODC_FQDN=3800-RODC-01.corp.agribank.com.vn \
#     bash scripts/kiem-tra-ldap-rodc.sh
#
# Script trả lời 4 câu hỏi trước khi bật tính năng đăng nhập bằng tài khoản AD:
#   1. Máy ảo có tới được RODC không, cổng LDAP nào đang mở?
#   2. Container API (nằm sau NAT của Docker) có tới được RODC không?
#   3. DNS trong máy ảo có phân giải được tên miền AD không?
#   4. Nếu cổng 636 (LDAPS) mở thì chứng chỉ do CA nào cấp, tên trên chứng chỉ
#      là gì — quyết định việc phải nạp CA gốc của ngân hàng vào container.
#
# ⚠ MỌI DÒNG IN RA CỐ Ý CHỈ DÙNG KÝ TỰ ASCII (không dấu tiếng Việt). Lệnh trên
#   PROD thường gõ qua RDP -> cửa sổ Hyper-V Connect, đường này làm rơi dấu
#   tiếng Việt nên chữ có dấu hiển thị/đối chiếu sai. Comment trong file thì
#   vẫn tiếng Việt bình thường vì file được git pull về, không ai gõ tay.
#
# Script CHỈ ĐỌC: không sửa cấu hình, không gửi mật khẩu đi đâu, chạy bao nhiêu
# lần cũng được.
# ============================================================================
set -uo pipefail   # cố ý KHÔNG dùng -e: một cổng đóng không được phép dừng cả bài kiểm tra

RODC_IP="${RODC_IP:-10.73.0.11}"
RODC_FQDN="${RODC_FQDN:-3800-RODC-01.corp.agribank.com.vn}"
AD_DOMAIN="${AD_DOMAIN:-corp.agribank.com.vn}"
CONTAINER="${CONTAINER:-quiz3800_api}"
CHO_GIAY="${CHO_GIAY:-4}"   # thời gian chờ tối đa cho mỗi lần thử kết nối (giây)

# 389 = LDAP thường (chữ rõ), 636 = LDAPS (TLS), 3268/3269 = Global Catalog.
# RODC vẫn có thể phục vụ Global Catalog nên dò luôn cả 4 cổng.
CAC_CONG=(389 636 3268 3269)

tieu_de() {
  echo
  echo "=================================================================="
  echo "$1"
  echo "=================================================================="
}

# Thử mở 1 kết nối TCP bằng /dev/tcp của bash — không cần cài nc/telnet/nmap,
# vốn thường không có sẵn trên bản Ubuntu Server tối giản.
thu_cong() {
  local ip="$1" cong="$2"
  if timeout "$CHO_GIAY" bash -c "exec 3<>/dev/tcp/${ip}/${cong}" 2>/dev/null; then
    echo "OPEN"
  else
    echo "closed/filtered"
  fi
}

# ---------------------------------------------------------------------------
tieu_de "1. TU MAY AO UBUNTU -> RODC ${RODC_IP}"

echo "-- ping (co the bi firewall chan ICMP, khong mo cung khong sao) --"
ping -c 2 -W 2 "$RODC_IP" 2>&1 | tail -3

echo
echo "-- cong TCP --"
co_636="no"
co_389="no"
for cong in "${CAC_CONG[@]}"; do
  kq=$(thu_cong "$RODC_IP" "$cong")
  printf "  %-5s -> %s\n" "$cong" "$kq"
  [ "$cong" = "636" ] && [ "$kq" = "OPEN" ] && co_636="yes"
  [ "$cong" = "389" ] && [ "$kq" = "OPEN" ] && co_389="yes"
done

# ---------------------------------------------------------------------------
tieu_de "2. TU TRONG CONTAINER API -> RODC ${RODC_IP}"
# Đây mới là phép thử có ý nghĩa thật: container nằm sau NAT của Docker bridge,
# gói tin đi container -> docker0/bridge -> eth0 máy ảo -> mạng ngân hàng.
# Image node:22-alpine KHÔNG có curl/nc/telnet nên dùng luôn module net của Node.

if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
  echo "BO QUA: khong thay container '${CONTAINER}' dang chay."
  echo "        (chay lai voi: sudo bash scripts/kiem-tra-ldap-rodc.sh)"
else
  docker exec "$CONTAINER" node -e "
const net = require('net');
const ip = '${RODC_IP}';
const ports = [${CAC_CONG[0]}, ${CAC_CONG[1]}, ${CAC_CONG[2]}, ${CAC_CONG[3]}];
const timeoutMs = ${CHO_GIAY} * 1000;
Promise.all(ports.map((p) => new Promise((resolve) => {
  const s = net.connect({ host: ip, port: p });
  s.setTimeout(timeoutMs);
  const done = (kq) => { s.destroy(); resolve('  ' + String(p).padEnd(5) + ' -> ' + kq); };
  s.on('connect', () => done('OPEN'));
  s.on('timeout', () => done('timeout'));
  s.on('error', (e) => done('closed (' + e.code + ')'));
}))).then((rows) => console.log(rows.join('\n')));
" 2>&1
fi

# ---------------------------------------------------------------------------
tieu_de "3. DNS: co phan giai duoc ten mien AD khong"
# Nếu DNS nội bộ phân giải được thì nên cấu hình ứng dụng trỏ tới FQDN thay vì
# IP — vì tên trên chứng chỉ LDAPS là FQDN, dùng IP sẽ làm hỏng bước kiểm tra
# chứng chỉ (xem mục 4).
for ten in "$RODC_FQDN" "$AD_DOMAIN"; do
  ip_ra=$(getent hosts "$ten" 2>/dev/null | awk '{print $1}' | paste -sd, -)
  if [ -n "$ip_ra" ]; then
    printf "  %-45s -> %s\n" "$ten" "$ip_ra"
  else
    printf "  %-45s -> KHONG phan giai duoc\n" "$ten"
  fi
done
echo
echo "  (DNS server may ao dang dung:)"
(resolvectl status 2>/dev/null | grep -i 'DNS Server' | head -5) \
  || (grep -i '^nameserver' /etc/resolv.conf 2>/dev/null | head -5) \
  || echo "  khong doc duoc"

# ---------------------------------------------------------------------------
tieu_de "4. CHUNG CHI LDAPS (cong 636)"

if [ "$co_636" != "yes" ]; then
  echo "BO QUA: cong 636 khong mo tu may ao nay."
  if [ "$co_389" = "yes" ]; then
    echo
    echo "CANH BAO: chi co cong 389 (LDAP khong ma hoa) dang mo."
    echo "  Mat khau Windows cua can bo se di qua mang duoi dang chu ro."
    echo "  Can de nghi quan tri AD bat LDAPS (636) tren may RODC truoc khi dung that."
  fi
elif ! command -v openssl >/dev/null 2>&1; then
  echo "BO QUA: may ao chua cai openssl (sudo apt-get install -y openssl)."
else
  echo "-- thong tin chung chi may chu tra ve --"
  chi_tiet=$(echo | timeout 10 openssl s_client -connect "${RODC_IP}:636" \
    -servername "$RODC_FQDN" 2>/dev/null \
    | openssl x509 -noout -subject -issuer -dates -ext subjectAltName 2>/dev/null)
  if [ -z "$chi_tiet" ]; then
    echo "  Khong lay duoc chung chi (may chu tu choi bat tay TLS?)."
  else
    echo "$chi_tiet" | sed 's/^/  /'
    echo
    echo "GHI CHU:"
    echo "  - Dong 'issuer' cho biet CA noi bo nao da cap. Phai nap CA goc do vao"
    echo "    container API thi ung dung moi tin duoc chung chi nay."
    echo "  - Doi chieu 'subjectAltName' voi ten ma ung dung se ket noi toi."
    echo "    Neu ung dung tro toi IP ${RODC_IP} ma SAN chi co ten may thi buoc"
    echo "    phai dung FQDN (${RODC_FQDN}), khong dung IP."
  fi
fi

# ---------------------------------------------------------------------------
tieu_de "TOM TAT"
echo "  RODC          : ${RODC_IP}  (${RODC_FQDN})"
echo "  Ten mien AD   : ${AD_DOMAIN}"
echo "  Cong 389 LDAP : ${co_389}"
echo "  Cong 636 LDAPS: ${co_636}"
echo
echo "Gui toan bo ket qua tren cho nguoi phat trien de chot cau hinh."
