#!/usr/bin/env bash
# ServisHP Pro — update via GIT PULL (docker / native otomatis terdeteksi)
# Pakai di server Ubuntu:  sudo ./deploy/update.sh
# Bisa dijalankan dari mana saja (otomatis cari folder project).
#
# Alur:
#   1. git fetch + pull --ff-only branch aktif (default: main)
#   2. File lokal yang TIDAK ikut update (aman): backend/.env, *.db, uploads/
#      (masuk .gitignore, jadi git pull tidak akan menimpanya)
#   3. Install ulang deps (native) / rebuild image (docker), restart, cek health
set -euo pipefail
if [[ $EUID -ne 0 ]]; then echo "Jalankan: sudo $0"; exit 1; fi

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"
echo "==> Project: $APP_DIR"

# --- 1. Git pull ---
if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "Bukan repo git. Clone dulu:"
  echo "  sudo mv /opt/pos-konter /opt/pos-konter.bak"
  echo "  sudo git clone https://github.com/pitujaya/pos-konter.git /opt/pos-konter"
  echo "  sudo cp /opt/pos-konter.bak/backend/.env /opt/pos-konter/backend/.env"
  exit 1
fi
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "==> Git pull (branch: $BRANCH)..."
git fetch origin
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"
if [[ "$LOCAL" == "$REMOTE" ]]; then
  echo "    Sudah terbaru ($LOCAL). Lanjut restart agar aman."
else
  echo "    Update tersedia: ${LOCAL:0:7} -> ${REMOTE:0:7}"
  # Amankan perubahan lokal tak disengaja (selain file penting), lalu pull
  git stash push -m "auto-update-$(date +%Y%m%d-%H%M%S)" 2>/dev/null || true
  git pull --ff-only origin "$BRANCH"
  echo "    Kode terbaru: $(git log --oneline -1)"
fi
chmod +x deploy/*.sh 2>/dev/null || true

# --- 2. Terapkan sesuai mode ---
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^pos-konter$'; then
  echo "==> Mode Docker: rebuild + restart..."
  docker compose up -d --build
  docker compose ps
elif systemctl is-active --quiet pos-konter 2>/dev/null || [[ -f /etc/systemd/system/pos-konter.service ]]; then
  echo "==> Mode native (systemd): install deps + restart..."
  if [[ -x "$APP_DIR/backend/.venv/bin/pip" ]]; then
    "$APP_DIR/backend/.venv/bin/pip" install -r "$APP_DIR/backend/requirements.txt"
  fi
  systemctl restart pos-konter
  sleep 3
  systemctl status pos-konter --no-pager | head -12
else
  echo "Service tidak ditemukan. Jalankan dulu: sudo ./deploy/deploy-ubuntu.sh --native"
  exit 1
fi

# --- 3. Health check ---
echo "==> Cek kesehatan API..."
for i in $(seq 1 15); do
  if curl -fsS http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
    curl -fsS http://127.0.0.1:8000/api/health; echo " OK"
    echo "Selesai."
    exit 0
  fi
  sleep 2
done
echo "WARN: API belum merespon. Cek log:"
echo "  docker: docker compose logs --tail 50   |   native: journalctl -u pos-konter -n 50"
exit 1
