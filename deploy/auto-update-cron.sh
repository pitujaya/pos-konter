#!/usr/bin/env bash
# ServisHP Pro — auto-update via cron (full-oto).
# Dipasang di server Ubuntu SEKALI, lalu tiap 5 menit cek GitHub:
#   ada commit baru -> git pull + bump versi aset + rebuild docker + cek health.
#   tidak ada -> diam (tidak rebuild, tidak ganggu kasir).
#
# Yang dijaga script ini:
#   - git pull --ff-only TIDAK boleh gagal karena working tree lokal berubah
#     -> perubahan lokal diamankan (git stash), hasil bump versi di-commit.
#   - bump versi aset (?v= di index.html) selalu sukses; kalau gagal deploy tetap jalan.
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
GIT_USER_NAME="${GIT_USER_NAME:-pos-konter-autoupdate}"
GIT_USER_EMAIL="${GIT_USER_EMAIL:-autoupdate@localhost}"

log() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }

# --- Fungsi: bump versi aset frontend (cache busting) ---
# index.html memuat style.css?v=..., config.js?v=..., api.js?v=..., script.js?v=...
# Tanpa bump, browser kasir bisa tetap memakai JS lama setelah update -> app rusak.
# Idempotent + aman: pola '?v=' tidak ditemukan -> warning, status 0.
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

# --- Smoke test setelah deploy ---
# Hanya memberi WARNING, tidak pernah menggagalkan update.
smoke_test() {
  # 1. Frontend harus bisa diakses dan memuat container aplikasi
  local html
  html="$(curl -fsS http://127.0.0.1:8000/ 2>/dev/null || true)"
  if ! grep -q 'id="mainApp"' <<< "$html"; then
    log "WARN: frontend tidak mengembalikan elemen id=\"mainApp\" — cek index.html / nginx."
  else
    log "OK: frontend termuat (id=\"mainApp\" ada)."
  fi

  # 2. Skema API (/openapi.json) TIDAK boleh publik
  if curl -fsS -o /dev/null http://127.0.0.1/openapi.json 2>/dev/null; then
    log "WARN: /openapi.json masih publik via nginx — cek deploy/nginx-pos-konter.conf (location = /openapi.json { return 404; })."
  fi
  if curl -fsS -o /dev/null http://127.0.0.1:8000/openapi.json 2>/dev/null; then
    log "WARN: /openapi.json terbuka di backend :8000 — pastikan port 8000 tidak dipublikasikan (firewall/cloudflared)."
  fi
}

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
# BEHIND = commit baru di upstream, AHEAD = commit lokal (mis. bump versi)
BEHIND="$(git rev-list --count "HEAD..origin/$BRANCH" 2>/dev/null || echo 0)"
AHEAD="$(git rev-list --count "origin/$BRANCH..HEAD" 2>/dev/null || echo 0)"
if [[ "$BEHIND" -eq 0 ]]; then
  # Tidak ada commit baru di upstream -> diam (tidak rebuild, tidak ganggu kasir).
  exit 0
fi

LOCAL_SHORT="$(git rev-parse --short HEAD 2>/dev/null || echo '?')"
REMOTE_SHORT="$(git rev-parse --short "origin/$BRANCH" 2>/dev/null || echo '?')"
log "UPDATE: ${LOCAL_SHORT} -> ${REMOTE_SHORT} ($(git log --oneline "HEAD..origin/$BRANCH" | head -3 | tr '\n' ';'))"

# --- 1. Pull ---
# Working tree lokal yang berubah (mis. hasil bump versi dari update.sh manual)
# disimpan ke stash supaya git pull tidak gagal dengan "local changes would be overwritten".
if ! git diff --quiet || ! git diff --cached --quiet; then
  git stash push -m "autoupdate-local-$(date +%Y%m%d-%H%M%S)" >> "$LOG" 2>&1 || true
  log "INFO: perubahan lokal disimpan ke git stash (lihat 'git stash list')."
fi

if [[ "$AHEAD" -gt 0 ]]; then
  # Ada commit lokal (bump versi) -> rebase ke upstream supaya tidak divergen.
  if ! git pull --rebase origin "$BRANCH" >> "$LOG" 2>&1; then
    git rebase --abort >> "$LOG" 2>&1 || true
    git reset --hard "origin/$BRANCH" >> "$LOG" 2>&1 || true
    log "WARN: rebase commit lokal gagal, reset ke upstream (bump versi diulang di bawah)."
  fi
else
  if ! git pull --ff-only origin "$BRANCH" >> "$LOG" 2>&1; then
    log "ERROR: git pull gagal, batal rebuild."
    exit 1
  fi
fi
log "KODE: $(git log --oneline -1)"

# --- 2. Bump versi aset frontend (cache busting) ---
# WAJIB setelah pull: browser kasir harus memuat JS/CSS baru, bukan versi lama.
# Hasilnya di-commit supaya working tree tetap bersih (pull --ff-only tetap bisa jalan).
# Semua step di sini WAJIB non-fatal: deploy tetap jalan walau bump/commit gagal.
bump_asset_version "$APP_DIR/index.html" >> "$LOG" 2>&1 || true
if ! git diff --quiet -- index.html; then
  git add index.html >> "$LOG" 2>&1 || true
  if ! git -c user.email="$GIT_USER_EMAIL" -c user.name="$GIT_USER_NAME" \
        commit -m "chore: bump asset version" >> "$LOG" 2>&1; then
    log "WARN: commit bump versi gagal (deploy tetap jalan)."
  else
    log "BUMP: versi aset di-commit ($(git rev-parse --short HEAD))."
  fi
fi

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
    smoke_test
    exit 0
  fi
  sleep 4
done
log "WARN: API belum merespon 60 dtk sesudah update. Cek: docker compose logs --tail 50"
exit 1
