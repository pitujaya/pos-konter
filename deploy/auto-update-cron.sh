#!/usr/bin/env bash
# ServisHP Pro — auto-update via cron (full-oto).
# Dipasang di server Ubuntu SEKALI, lalu tiap 5 menit cek GitHub:
#   ada commit baru -> git pull + rebuild docker + cek health.
#   tidak ada -> diam (tidak rebuild, tidak ganggu kasir).
#
# Pasang:
#   cd /opt/pos-konter && sudo cp deploy/auto-update-cron.sh /usr/local/bin/pos-konter-autoupdate
#   sudo chmod +x /usr/local/bin/pos-konter-autoupdate
#   (crontab dipasang otomatis oleh perintah di bawah)
#
# Log: /var/log/pos-konter-autoupdate.log
# Kunci: /tmp/pos-konter-autoupdate.lock (cegah build ganda)
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/pos-konter}"
LOG="${LOG_FILE:-/var/log/pos-konter-autoupdate.log}"
BRANCH="${BRANCH:-main}"

log() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }

# cegah 2 build jalan bareng (cron tiap 5 mnt + build bisa 2 mnt)
exec 9>/tmp/pos-konter-autoupdate.lock
if ! flock -n 9; then
  exit 0
fi

cd "$APP_DIR"
if [[ ! -d .git ]]; then
  log "SKIP: $APP_DIR bukan repo git (pakai git clone sekali, lihat panduan)."
  exit 0
fi

git fetch origin "$BRANCH" >> "$LOG" 2>&1 || { log "WARN: git fetch gagal (internet/remote?)"; exit 0; }
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"
if [[ "$LOCAL" == "$REMOTE" ]]; then
  exit 0
fi

log "UPDATE: ${LOCAL:0:7} -> ${REMOTE:0:7} ($(git log --oneline "$LOCAL..$REMOTE" | head -3 | tr '\n' ';'))"
if ! git pull --ff-only origin "$BRANCH" >> "$LOG" 2>&1; then
  log "ERROR: git pull gagal, batal rebuild."
  exit 1
fi
log "KODE: $(git log --oneline -1)"

# rebuild hanya bila docker tersedia + service ada
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^pos-konter$'; then
  if ! docker compose up -d --build >> "$LOG" 2>&1; then
    log "ERROR: docker compose up gagal."
    exit 1
  fi
  # jaga izin DB (container jalan sebagai appuser)
  docker exec -u 0 pos-konter chown -R appuser:appuser /data >> "$LOG" 2>&1 || true
  docker restart pos-konter >> "$LOG" 2>&1 || true
elif systemctl is-active --quiet pos-konter 2>/dev/null; then
  systemctl restart pos-konter >> "$LOG" 2>&1 || true
fi

for i in $(seq 1 15); do
  if curl -fsS http://127.0.0.1:8000/api/health >> "$LOG" 2>&1; then
    log "OK: health 200 sesudah update."
    exit 0
  fi
  sleep 4
done
log "WARN: API belum merespon 60 dtk sesudah update. Cek: docker compose logs --tail 50"
exit 1
