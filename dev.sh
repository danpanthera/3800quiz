#!/bin/bash
# ============================================================
# dev.sh — 3800Quiz dev starter
# AN TOÀN với OrbStack: KHÔNG dùng lsof/kill trên port Docker
# Docker (postgres, api, web) quản lý bởi OrbStack → chỉ
# dùng docker compose để start/stop, tuyệt đối không kill PID
# đang giữ port đó vì có thể là OrbStack Helper daemon.
# ============================================================
set -e

ROOT="/opt/Projects/3800quiz"

API_PORT=13011
WEB_PORT=15174
DB_PORT=15434

GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; RED='\033[0;31m'; NC='\033[0m'

echo -e "${CYAN}"
echo "  ╔═══════════════════════════════╗"
echo "  ║     3800Quiz Dev Server       ║"
echo "  ╚═══════════════════════════════╝"
echo -e "${NC}"

# ── 1. Mở OrbStack nếu chưa chạy ──────────────────────────
if ! docker info >/dev/null 2>&1; then
  echo -e "${YELLOW}[ORBSTACK]${NC} Đang khởi động OrbStack..."
  open -a OrbStack 2>/dev/null || true
fi

# ── 2. Chờ Docker daemon sẵn sàng ─────────────────────────
DOCKER_WAIT=0
until docker info >/dev/null 2>&1; do
  DOCKER_WAIT=$((DOCKER_WAIT+1))
  if [ $DOCKER_WAIT -gt 90 ]; then
    echo -e "${RED}[ERROR]${NC} Docker daemon chưa ready sau 90s."
    echo -e "  Thử: open -a OrbStack  rồi chờ 30s và chạy lại ./dev.sh"
    exit 1
  fi
  printf "${YELLOW}.${NC}"; sleep 1
done
[ $DOCKER_WAIT -gt 0 ] && echo ""
echo -e "${CYAN}[DOCKER]${NC} Daemon ready ✓"

# ── 3. Khởi động DB + API + Web qua Docker Compose ────────
# KHÔNG dùng lsof/kill -9 trên các port Docker (13011, 15174, 15434)
# OrbStack dùng scon daemon để forward port → kill nó = crash VM.
# docker compose up -d xử lý đúng: start nếu chưa có, skip nếu đã chạy.

echo -e "${YELLOW}[DB]${NC} Khởi động PostgreSQL..."
docker compose -f "$ROOT/docker-compose.yml" up -d postgres 2>&1 | grep -v "^$" || true

PG_WAIT=0
until docker exec quiz3800_db pg_isready -U postgres &>/dev/null 2>&1; do
  PG_WAIT=$((PG_WAIT+1))
  if [ $PG_WAIT -gt 30 ]; then
    echo -e "${RED}[DB]${NC} PostgreSQL không ready sau 30s."
    exit 1
  fi
  printf "${YELLOW}.${NC}"; sleep 1
done
[ $PG_WAIT -gt 0 ] && echo ""
echo -e "${YELLOW}[DB]${NC} PostgreSQL ready ✓  →  localhost:${DB_PORT}"

# api/web build code NGAY TRONG image (Dockerfile COPY . . rồi build) — không mount
# source từ host, nên bắt buộc --build ở mỗi lần chạy để luôn dùng code mới nhất.
# Docker cache theo nội dung file COPY nên khi code không đổi vẫn chạy nhanh như cũ.
echo -e "${GREEN}[API]${NC} Build + khởi động API (code mới nhất)..."
docker compose -f "$ROOT/docker-compose.yml" up -d --build api 2>&1 | grep -v "^$" || true
echo -e "${GREEN}[API]${NC} API ready ✓  →  http://localhost:${API_PORT}/api"

echo -e "${CYAN}[WEB]${NC} Build + khởi động Web portal (code mới nhất)..."
docker compose -f "$ROOT/docker-compose.yml" up -d --build web 2>&1 | grep -v "^$" || true
echo -e "${CYAN}[WEB]${NC} Web ready ✓  →  http://localhost:${WEB_PORT}"

# ── 4. Tóm tắt ────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  ✓ 3800Quiz đang chạy                          ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  🗄  DB:   ${CYAN}localhost:${DB_PORT}${NC}                [Docker]"
echo -e "  🚀 API:  ${GREEN}http://localhost:${API_PORT}/api${NC}   [Docker]"
echo -e "  🖥  Web:  ${GREEN}http://localhost:${WEB_PORT}${NC}        [Docker]"
echo ""
echo -e "  Logs:     ${CYAN}docker compose logs -f api${NC}  |  ${CYAN}docker compose logs -f web${NC}"
echo -e "  Stop:     ${CYAN}docker compose stop${NC}   ← giữ nguyên data"
echo -e "  Restart (code mới): ${CYAN}docker compose up -d --build api web${NC}  ← restart thường KHÔNG lấy code mới"
echo ""
