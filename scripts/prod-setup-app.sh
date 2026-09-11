#!/usr/bin/env bash
# ============================================================================
# 3800Quiz — Cài Docker + build + khởi tạo toàn bộ ứng dụng NGAY TRONG máy ảo
# Ubuntu, lúc máy chủ PROD đang được cắm Internet tạm thời (DEPLOYMENT.md
# Giai đoạn 2.3).
#
# Dùng (lần đầu):
#   bash prod-setup-app.sh https://github.com/<đường-dẫn-repo-thật>/3800quiz.git
# Chạy lại (đã có mã nguồn ở /opt/3800quiz — không cần URL):
#   cd /opt/3800quiz && git pull && bash scripts/prod-setup-app.sh
#
# CHẠY LẠI BAO NHIÊU LẦN CŨNG AN TOÀN — lỗi hay bị ngắt giữa chừng thì cứ chạy
# lại đúng lệnh: bí mật đã sinh được giữ nguyên, bước nào dở dang tự làm lại.
#
# Tuỳ chọn (biến môi trường đặt trước lệnh):
#   SKIP_BUILD=1         dùng lại ảnh Docker đã build sẵn trên máy, không build lại
#   IMAGES_TAR=<file>    nạp ảnh dựng sẵn ở máy khác (.tar/.tar.gz — Phụ lục D)
#   SITE_ADDRESS=<tên>   tên DNS nội bộ (mặc định quiz.vbaquangbinh.com)
#
# Sau khi chạy xong: lưu lại JWT_SECRET/POSTGRES_PASSWORD được in ra cuối
# script vào kho mật khẩu ngân hàng, rồi làm theo Giai đoạn 3.
# ============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/3800quiz}"
SITE_ADDRESS="${SITE_ADDRESS:-quiz.vbaquangbinh.com}"
SKIP_BUILD="${SKIP_BUILD:-0}"
IMAGES_TAR="${IMAGES_TAR:-}"
CURRENT_USER="${USER:-$(id -un)}"

REPO_URL="${1:-}"
if [ -z "$REPO_URL" ] && [ -d "$APP_DIR/.git" ]; then
  REPO_URL="$(git -C "$APP_DIR" remote get-url origin)"
fi
if [ -z "$REPO_URL" ]; then
  echo 'Cách dùng: prod-setup-app.sh <git-url-repo-3800quiz>' >&2
  exit 1
fi

if [ -n "$IMAGES_TAR" ]; then
  [ -f "$IMAGES_TAR" ] || { echo "Không thấy file ảnh Docker: $IMAGES_TAR" >&2; exit 1; }
  IMAGES_TAR="$(realpath "$IMAGES_TAR")"
fi

log() { echo -e "\033[36m[prod-setup-app]\033[0m $1"; }

# ── 1. Cài Docker (CẦN Internet — đúng lúc này PROD đang tạm có mạng) ───────
if ! command -v docker >/dev/null 2>&1; then
  log 'Đang cài Docker Engine...'
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$CURRENT_USER"
  sudo systemctl enable docker
  log 'Đã cài Docker. Dùng sudo cho các lệnh docker trong chính script này (nhóm quyền mới cần đăng nhập lại mới có hiệu lực).'
else
  log 'Docker đã có sẵn — bỏ qua bước cài.'
fi

# ── 2. Lấy mã nguồn ──────────────────────────────────────────────────────────
if [ -d "$APP_DIR/.git" ]; then
  log "Mã nguồn đã có ở $APP_DIR — chạy git pull..."
  sudo git -C "$APP_DIR" pull --ff-only
else
  log "Đang clone mã nguồn vào $APP_DIR..."
  sudo git clone "$REPO_URL" "$APP_DIR"
fi
sudo chown -R "$CURRENT_USER":"$CURRENT_USER" "$APP_DIR"
cd "$APP_DIR"

COMPOSE=(sudo docker compose -f docker-compose.prod.yml --env-file .env.prod)

# ── 3. .env.prod với bí mật sinh tự động ─────────────────────────────────────
if [ ! -f .env.prod ]; then
  log 'Đang tạo .env.prod từ mẫu .env.prod.example...'
  cp .env.prod.example .env.prod
  sed -i "s#^SITE_ADDRESS=.*#SITE_ADDRESS=${SITE_ADDRESS}#" .env.prod
  sed -i "s#^CORS_ORIGIN=.*#CORS_ORIGIN=https://${SITE_ADDRESS}#" .env.prod
fi
chmod 600 .env.prod

env_value() { grep -m1 "^$1=" .env.prod | cut -d= -f2- || true; }

# Kiểm tra MỖI LẦN chạy (không chỉ lúc mới tạo file) nên tự sửa được cả
# .env.prod dở dang còn sót chữ mẫu từ lần chạy trước bị lỗi. Sinh bằng
# `openssl rand -hex` — chỉ gồm chữ và số, hợp lệ cho cả DATABASE_URL.
# KHÔNG dùng `tr ... </dev/urandom | head`: dưới pipefail, tr bị SIGPIPE khiến
# cả script thoát im lặng (lỗi đã gặp thật trên PROD).
ensure_secret() {
  local key="$1" min_len="$2" value new
  value="$(env_value "$key")"
  if [ -n "$value" ] && [ "${value#THAY_BANG_}" = "$value" ] && [ "${#value}" -ge "$min_len" ]; then
    return 0
  fi
  new="$(openssl rand -hex 32)"
  if grep -q "^${key}=" .env.prod; then
    sed -i "s#^${key}=.*#${key}=${new}#" .env.prod
  else
    echo "${key}=${new}" >> .env.prod
  fi
  log "Đã sinh ${key} ngẫu nhiên (giá trị cũ để trống, còn chữ mẫu hoặc quá ngắn)."
}
ensure_secret POSTGRES_PASSWORD 1
ensure_secret JWT_SECRET 32   # API từ chối khởi động nếu ngắn hơn 32 ký tự

# ── 4. Ảnh Docker ────────────────────────────────────────────────────────────
if [ -n "$IMAGES_TAR" ]; then
  log "Đang nạp ảnh Docker dựng sẵn từ $IMAGES_TAR — bỏ qua bước build..."
  case "$IMAGES_TAR" in
    *.gz) gunzip -c "$IMAGES_TAR" | sudo docker load ;;
    *)    sudo docker load -i "$IMAGES_TAR" ;;
  esac
elif [ "$SKIP_BUILD" = "1" ]; then
  log 'SKIP_BUILD=1 — dùng lại ảnh Docker đã có trên máy, bỏ qua bước build.'
else
  log 'Đang build ảnh Docker (npm ci tải thư viện — cần Internet, đúng lúc này có)...'
  "${COMPOSE[@]}" build
fi

# ── 5. Khởi tạo cơ sở dữ liệu (trước khi bật API) ────────────────────────────
log 'Đang khởi động Postgres...'
"${COMPOSE[@]}" up -d --wait --wait-timeout 120 postgres

# Postgres chỉ đặt mật khẩu lúc khởi tạo volume LẦN ĐẦU: nếu volume từng được
# khởi tạo bằng mật khẩu khác (VD chữ mẫu từ lần chạy lỗi trước) thì API sẽ
# không đăng nhập được DB. Đồng bộ lại qua socket nội bộ của container (không
# cần mật khẩu cũ, không mất dữ liệu) — chạy lần nào cũng vô hại.
log 'Đang đồng bộ POSTGRES_PASSWORD trong .env.prod vào Postgres...'
"${COMPOSE[@]}" exec -T postgres sh -c \
  'psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "ALTER USER \"$POSTGRES_USER\" WITH PASSWORD '\''$POSTGRES_PASSWORD'\''"'

# Dùng container chạy một lần (run --rm) thay vì exec vào API đang chạy: không
# phụ thuộc API đã khởi động được hay chưa, và API chỉ bật khi đã có đủ bảng.
log 'Đang chạy prisma migrate deploy...'
"${COMPOSE[@]}" run --rm -T api npx prisma migrate deploy

log 'Đang seed dữ liệu nền (7 chi nhánh + phòng ban, cấp độ/huy hiệu, tài khoản mẫu)...'
"${COMPOSE[@]}" run --rm -T api npm run seed

# ── 6. Bật toàn bộ hệ thống ──────────────────────────────────────────────────
# 240s vì Caddy giờ đợi api "healthy" rồi mới bật (xem docker-compose.prod.yml)
# — cộng dồn thời gian start_period của cả hai thay vì chạy song song.
log 'Đang khởi động toàn bộ container, chờ "healthy" (tối đa 4 phút)...'
if ! "${COMPOSE[@]}" up -d --wait --wait-timeout 240; then
  "${COMPOSE[@]}" ps -a
  for svc in $("${COMPOSE[@]}" ps -a --format '{{.Service}} {{.Health}}' | awk '$2 != "healthy" {print $1}'); do
    echo "──── 40 dòng log cuối của $svc ────"
    "${COMPOSE[@]}" logs --tail 40 "$svc"
  done
  echo ''
  echo 'LỖI: có container chưa chạy ổn định — chụp phần log ở trên để chẩn đoán.'
  echo 'Sửa xong nguyên nhân thì chạy lại đúng lệnh này, không cần xoá gì.'
  exit 1
fi
"${COMPOSE[@]}" ps

# ── 7. Tóm tắt ────────────────────────────────────────────────────────────────
echo ''
log 'Kiểm tra nội bộ qua cổng 8080 (không qua HTTPS):'
curl -fsS http://127.0.0.1:8080/api/health || echo '(chưa gọi được /api/health — thử lại sau vài giây)'
echo ''
echo ''
echo '=== XONG — LƯU NGAY 2 GIÁ TRỊ SAU VÀO KHO MẬT KHẨU NGÂN HÀNG ==='
grep -E '^(JWT_SECRET|POSTGRES_PASSWORD)=' .env.prod
echo ''
echo 'Bước tiếp theo: NGẮT Internet khỏi máy chủ, làm theo DEPLOYMENT.md Giai đoạn 3'
echo '(chuyển sang IP tĩnh nội bộ, đăng ký DNS quiz.vbaquangbinh.com qua RODC).'
