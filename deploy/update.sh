#!/usr/bin/env bash
# ServisHP Pro — update via GIT PULL (docker / native otomatis terdeteksi)
# Pakai di server Ubuntu:  sudo ./deploy/update.sh
# Bisa dijalankan dari mana saja (otomatis cari folder project).
#
# Alur:
#   1. git fetch + pull --ff-only branch aktif (default: main)
#   2. File lokal yang TIDAK ikut update (aman): backend/.env, *.db, uploads/
#      (masuk .gitignore, jadi git pull tidak akan menimpanya)
#   3. Bump versi aset frontend (?v= di index.html) -> cache busting browser
#   4. Install ulang deps (native) / rebuild image (docker), restart, cek health
set -euo pipefail
if [[ $EUID -ne 0 ]]; then echo "Jalankan: sudo $0"; exit 1; fi

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"
echo "==> Project: $APP_DIR"

# --- Fungsi: bump versi aset frontend (cache busting) ---
# index.html memuat style.css?v=..., config.js?v=..., api.js?v=..., script.js?v=...
# Query ?v= hanya berubah kalau ada deploy; tanpa bump, browser kasir bisa tetap
# memakai JS lama (cache browser) sehingga aplikasi error / data tidak sinkron.
# Idempotent: boleh dijalankan berulang. Kalau pola '?v=' tidak ditemukan,
# script hanya memberi warning dan keluar dengan status 0 (tidak menggagalkan deploy).
bump_asset_version() {
  local target="${1:-index.html}"
  if [[ ! -f "$target" ]]; then
    echo "WARN: $target tidak ditemukan, lewati bump versi aset." >&2
    return 0
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    echo "WARN: python3 tidak tersedia, lewati bump versi aset." >&2
    return 0
  fi
  python3 - "$target" <<'PY' || true
import io
import re
import sys
from datetime import datetime

path = sys.argv[1]
try:
    with io.open(path, "r", encoding="utf-8") as f:
        src = f.read()
except (IOError, OSError) as exc:
    sys.stderr.write("WARN: tidak bisa baca %s (%s)\n" % (path, exc))
    sys.exit(0)

pattern = re.compile(r"(\?v=)[0-9A-Za-z._-]+")
found = pattern.findall(src)
if not found:
    sys.stderr.write("WARN: pola '?v=' tidak ditemukan di %s, lewati bump versi.\n" % path)
    sys.exit(0)

version = datetime.now().strftime("%y%m%d%H%M")
out = pattern.sub(lambda m: m.group(1) + version, src)
if out != src:
    with io.open(path, "w", encoding="utf-8", newline="") as f:
        f.write(out)
sys.stderr.write("INFO: versi aset -> ?v=%s (%d referensi)\n" % (version, len(found)))
PY
  return 0
}

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

# --- 1b. Bump versi aset frontend (cache busting) ---
# WAJIB setelah git pull: kalau ada deploy JS/CSS baru, browser harus memuat
# file baru (query ?v= berubah), bukan file lama dari cache.
# Step ini tidak boleh menggagalkan deploy -> selalu || true.
echo "==> Bump versi aset frontend (cache busting)..."
bump_asset_version "$APP_DIR/index.html" || true

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
    # Smoke test ringan: frontend harus bisa diakses & /openapi.json tidak publik
    HTML="$(curl -fsS http://127.0.0.1:8000/ 2>/dev/null || true)"
    if ! grep -q 'id="mainApp"' <<< "$HTML"; then
      echo "WARN: frontend tidak mengembalikan elemen id=\"mainApp\" — cek index.html."
    fi
    if curl -fsS -o /dev/null http://127.0.0.1/openapi.json 2>/dev/null; then
      echo "WARN: /openapi.json masih publik via nginx — cek deploy/nginx-pos-konter.conf."
    fi
    if curl -fsS -o /dev/null http://127.0.0.1:8000/openapi.json 2>/dev/null; then
      echo "WARN: /openapi.json terbuka di backend :8000 — pastikan port 8000 tidak dipublikasikan."
    fi
    echo "Selesai."
    exit 0
  fi
  sleep 2
done
echo "WARN: API belum merespon. Cek log:"
echo "  docker: docker compose logs --tail 50   |   native: journalctl -u pos-konter -n 50"
exit 1
