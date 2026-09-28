#!/usr/bin/env bash
# ServisHP Pro — update cepat di Ubuntu (docker / native otomatis terdeteksi)
# Pakai: sudo ./deploy/update.sh   (dari folder project)
set -euo pipefail
if [[ $EUID -ne 0 ]]; then echo "Jalankan: sudo $0"; exit 1; fi

if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^pos-konter$'; then
  echo "==> Update mode Docker..."
  docker compose pull 2>/dev/null || true
  docker compose up -d --build
  docker compose ps
  curl -fsS http://127.0.0.1:8000/api/health && echo " OK"
elif systemctl is-active --quiet pos-konter 2>/dev/null; then
  echo "==> Update mode native (systemd)..."
  # Bila project di-sync manual (scp/rsync/git), cukup restart + cek:
  if [[ -x "/opt/pos-konter/backend/.venv/bin/pip" ]]; then
    /opt/pos-konter/backend/.venv/bin/pip install -r /opt/pos-konter/backend/requirements.txt
  fi
  systemctl restart pos-konter
  sleep 3
  systemctl status pos-konter --no-pager | head -20
  curl -fsS http://127.0.0.1:8000/api/health && echo " OK"
else
  echo "Service tidak ditemukan. Jalankan dulu deploy-ubuntu.sh"
  exit 1
fi
echo "Selesai."
