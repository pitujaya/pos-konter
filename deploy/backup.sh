#!/usr/bin/env bash
# ServisHP Pro — backup SQLite + uploads
# Pakai manual: sudo ./deploy/backup.sh
# Otomatis harian: sudo crontab -e  ->  0 2 * * * /opt/pos-konter/deploy/backup.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/pos-konter}"
KEEP="${KEEP:-14}"
DATE="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# Cari database: docker volume, native, atau dev
DB_CANDIDATES=(
  "/var/lib/docker/volumes/pos-konter-data/_data/servishp.db"
  "/opt/pos-konter/backend/servishp.db"
  "$APP_DIR/backend/servishp.db"
)
UPLOAD_CANDIDATES=(
  "/var/lib/docker/volumes/pos-konter-data/_data/uploads"
  "/opt/pos-konter/backend/app/uploads"
  "$APP_DIR/backend/app/uploads"
)
DB=""; for c in "${DB_CANDIDATES[@]}"; do [[ -f "$c" ]] && DB="$c" && break; done
UP=""; for c in "${UPLOAD_CANDIDATES[@]}"; do [[ -d "$c" ]] && UP="$c" && break; done

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [[ -n "$DB" ]]; then
  # Backup konsisten via sqlite3 .backup (bukan cp mentah)
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$DB" ".backup '$TMP/servishp.db'" || cp "$DB" "$TMP/servishp.db"
  else
    cp "$DB" "$TMP/servishp.db"
  fi
fi
[[ -n "$UP" ]] && cp -r "$UP" "$TMP/uploads" || mkdir -p "$TMP/uploads"
[[ -f "$APP_DIR/backend/.env" ]] && cp "$APP_DIR/backend/.env" "$TMP/env-backup.txt" || true

tar -czf "$BACKUP_DIR/pos-konter-$DATE.tar.gz" -C "$TMP" .
ls -t "$BACKUP_DIR"/pos-konter-*.tar.gz | tail -n +$((KEEP + 1)) | xargs -r rm -f
echo "Backup OK: $BACKUP_DIR/pos-konter-$DATE.tar.gz (DB: ${DB:-?})"
echo "Restore: tar -xzf <file> -C /tmp/restore && cp servishp.db ke lokasi DB + uploads ke UPLOAD_DIR"
