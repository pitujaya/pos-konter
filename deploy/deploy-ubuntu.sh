#!/usr/bin/env bash
# ServisHP Pro — Installer otomatis Ubuntu 22.04 / 24.04
# ======================================================
# Jalankan di SERVER UBUNTU dari folder project (yang ada docker-compose.yml):
#
#   chmod +x deploy/deploy-ubuntu.sh
#   sudo ./deploy/deploy-ubuntu.sh                      # Docker (disarankan)
#   sudo ./deploy/deploy-ubuntu.sh --native             # Tanpa Docker (venv + systemd + nginx)
#   sudo ./deploy/deploy-ubuntu.sh --domain pos.tokomu.id --email admin@tokomu.id
#   sudo ./deploy/deploy-ubuntu.sh --tunnel pos-konter  # + Cloudflare Tunnel (opsional)
#
# Yang dilakukan script:
#  1. Install dependensi (python, nginx, ufw, sqlite3, curl...)
#  2. Buatkan backend/.env (SECRET_KEY acak) bila belum ada
#  3. Mode docker: install docker bila perlu + `docker compose up -d --build`
#     Mode native: venv + systemd service + nginx reverse proxy
#  4. Buka firewall (22/80/443/8000), cek /api/health, tampilkan ringkasan
set -euo pipefail

MODE="docker"
DOMAIN=""
EMAIL=""
TUNNEL_NAME=""

for arg in "$@"; do
  case "$arg" in
    --native) MODE="native" ;;
    --docker) MODE="docker" ;;
    --domain=*) DOMAIN="${arg#*=}" ;;
    --email=*) EMAIL="${arg#*=}" ;;
    --tunnel=*) TUNNEL_NAME="${arg#*=}" ;;
    --domain|--email|--tunnel)
      echo "Pakai bentuk --domain=... --email=... --tunnel=..."; exit 1 ;;
    -h|--help)
      sed -n '1,20p' "$0"; exit 0 ;;
    *) echo "Argumen tidak dikenal: $arg"; exit 1 ;;
  esac
done

# --- 0. Validasi ---
if [[ $EUID -ne 0 ]]; then echo "Jalankan sebagai root: sudo $0"; exit 1; fi
if [[ ! -f "docker-compose.yml" || ! -d "backend/app" ]]; then
  echo "ERROR: jalankan dari folder project (harus ada docker-compose.yml + backend/app)."
  echo "Contoh: cd /opt/pos-konter && sudo ./deploy/deploy-ubuntu.sh"
  exit 1
fi
APP_DIR="$(pwd)"
echo "==> [1/7] Direktori project: $APP_DIR (mode: $MODE)"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y python3 python3-venv python3-pip nginx ufw curl sqlite3 ca-certificates gnupg lsb-release nano

# --- 2. backend/.env ---
if [[ ! -f "backend/.env" ]]; then
  echo "==> [2/7] Membuat backend/.env baru (SECRET_KEY acak)..."
  SECRET="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
  sed "s/^SECRET_KEY=.*/SECRET_KEY=${SECRET}/" backend/.env.example > backend/.env
  chmod 600 backend/.env
else
  echo "==> [2/7] backend/.env sudah ada, tidak ditimpa."
fi
# Compose membaca interpolasi ${SECRET_KEY} dari .env di ROOT project (bukan backend/.env),
# jadi salin agar `docker compose up` tidak error "required variable SECRET_KEY".
cp backend/.env ./.env
chmod 600 ./.env || true

mkdir -p backend/app/uploads
chmod -R 775 backend/app/uploads || true

if [[ "$MODE" == "docker" ]]; then
  # --- 3a. Docker ---
  echo "==> [3/7] Mode Docker: cek instalasi docker..."
  if ! command -v docker >/dev/null 2>&1; then
    echo "    Docker belum ada, menginstall..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
  fi
  if ! docker compose version >/dev/null 2>&1; then
    echo "ERROR: plugin 'docker compose' tidak tersedia."; exit 1
  fi
  echo "==> [4/7] Build + jalankan container..."
  docker compose up -d --build
  echo "    Menunggu API siap (maks 60 dtk)..."
  for i in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:8000/api/health >/dev/null 2>&1; then break; fi
    sleep 2
    if [[ $i -eq 30 ]]; then echo "WARN: API belum merespon, cek: docker compose logs"; fi
  done
  # Nginx tetap dipasang sebagai reverse proxy :80 -> :8000 (biar rapi + siap HTTPS)
  NGINX_CONF="/etc/nginx/sites-available/pos-konter"
  cp deploy/nginx-pos-konter.conf "$NGINX_CONF"
  sed -i "s/SERVER_DOMAIN/${DOMAIN:-_}/g" "$NGINX_CONF"
  ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/pos-konter
  rm -f /etc/nginx/sites-enabled/default || true
  nginx -t && systemctl enable --now nginx && systemctl reload nginx
else
  # --- 3b. Native (venv + systemd) ---
  echo "==> [3/7] Mode native: buat user + venv + systemd..."
  id -u poskonter >/dev/null 2>&1 || useradd -r -m -s /usr/sbin/nologin poskonter
  if [[ "$APP_DIR" != "/opt/pos-konter" ]]; then
    echo "    Menyalin project ke /opt/pos-konter ..."
    mkdir -p /opt/pos-konter
    cp -r "$APP_DIR"/. /opt/pos-konter/
    APP_DIR="/opt/pos-konter"
    cd "$APP_DIR"
  fi
  chown -R poskonter:poskonter "$APP_DIR"
  sudo -u poskonter python3 -m venv "$APP_DIR/backend/.venv"
  "$APP_DIR/backend/.venv/bin/pip" install --upgrade pip
  "$APP_DIR/backend/.venv/bin/pip" install -r "$APP_DIR/backend/requirements.txt"
  cp deploy/pos-konter.service /etc/systemd/system/pos-konter.service
  systemctl daemon-reload
  systemctl enable --now pos-konter
  echo "    Menunggu API siap (maks 60 dtk)..."
  for i in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:8000/api/health >/dev/null 2>&1; then break; fi
    sleep 2
  done
  NGINX_CONF="/etc/nginx/sites-available/pos-konter"
  cp deploy/nginx-pos-konter.conf "$NGINX_CONF"
  sed -i "s/SERVER_DOMAIN/${DOMAIN:-_}/g" "$NGINX_CONF"
  ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/pos-konter
  rm -f /etc/nginx/sites-enabled/default || true
  nginx -t && systemctl enable --now nginx && systemctl reload nginx
  chown -R poskonter:poskonter "$APP_DIR/backend/app/uploads" "$APP_DIR/backend/servishp.db" 2>/dev/null || true
fi

# --- 5. Firewall ---
echo "==> [5/7] Firewall (ufw): buka 22/80/443/8000..."
ufw allow OpenSSH >/dev/null 2>&1 || ufw allow 22/tcp >/dev/null 2>&1 || true
ufw allow 80/tcp >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true
ufw allow 8000/tcp >/dev/null 2>&1 || true
yes | ufw enable >/dev/null 2>&1 || true

# --- 6. HTTPS otomatis bila domain diisi ---
if [[ -n "$DOMAIN" && "$DOMAIN" != "_" ]]; then
  echo "==> [6/7] Domain terdeteksi ($DOMAIN): pasang HTTPS via certbot..."
  apt-get install -y certbot python3-certbot-nginx
  if [[ -n "$EMAIL" ]]; then
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect || echo "WARN: certbot gagal, cek DNS A $DOMAIN -> IP server."
  else
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect || echo "WARN: certbot gagal, cek DNS A $DOMAIN -> IP server."
  fi
  # Auto-renew sudah via systemd timer bawaan certbot.
else
  echo "==> [6/7] Tanpa domain: akses via http://IP_SERVER/ (tambah --domain untuk HTTPS)."
fi

# --- Cloudflare Tunnel opsional (ALWAYS-ON: bikin VPS tetap online walau PC Windows mati) ---
if [[ -n "$TUNNEL_NAME" ]]; then
  echo "==> [7/7] Cloudflare Tunnel always-on ($TUNNEL_NAME) ..."
  # Install cloudflared bila belum ada (repo resmi Cloudflare)
  if ! command -v cloudflared >/dev/null 2>&1; then
    echo "    Install cloudflared dari repo resmi..."
    mkdir -p --mode=0755 /usr/share/keyrings
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
    echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | tee /etc/apt/sources.list.d/cloudflared.list
    apt-get update -y
    apt-get install -y cloudflared
  fi
  # Pasang systemd service agar tunnel hidup terus + auto-start saat reboot
  if [[ -f "$APP_DIR/deploy/cloudflared-pos-konter.service" ]]; then
    # Sesuaikan nama tunnel bila user pakai nama selain pos-konter
    sed "s/run pos-konter$/run $TUNNEL_NAME/; s/tunnel: pos-konter/tunnel: $TUNNEL_NAME/" \
      "$APP_DIR/deploy/cloudflared-ubuntu.yml" > /tmp/cloudflared-ubuntu.yml.tmp || true
    # Hanya timpa bila pakai nama custom; aman karena isi sama kecuali nama
    if [[ "$TUNNEL_NAME" != "pos-konter" ]]; then
      cp /tmp/cloudflared-ubuntu.yml.tmp "$APP_DIR/deploy/cloudflared-ubuntu.yml" || true
    fi
    # Auto-cocokkan credentials-file dengan file *.json yang ada
    # (nama file asli = <TUNNEL-ID>.json, bukan pos-konter.json)
    REAL_JSON="$(ls -t /root/.cloudflared/*.json 2>/dev/null | head -n1 || true)"
    if [[ -n "${REAL_JSON:-}" ]]; then
      echo "    Kredensial tunnel ditemukan: $REAL_JSON"
      sed -i "s|^credentials-file:.*|credentials-file: $REAL_JSON|" "$APP_DIR/deploy/cloudflared-ubuntu.yml"
    else
      echo "    Belum ada /root/.cloudflared/*.json (wajar bila belum login / belum copy dari Windows)."
    fi
    sed "s/run pos-konter$/run $TUNNEL_NAME/" \
      "$APP_DIR/deploy/cloudflared-pos-konter.service" > /etc/systemd/system/cloudflared-pos-konter.service
    systemctl daemon-reload
    systemctl enable cloudflared-pos-konter || true
    echo ""
    echo "    Service cloudflared-pos-konter dipasang (enable), TAPI belum di-start."
    echo "    PILIH SALAH SATU (cukup sekali):"
    echo "    A. PINDAHKAN tunnel lama dari Windows (TANPA buat baru, DNS tetap):"
    echo "       # di Windows (PowerShell):"
    echo "       scp \"\$env:USERPROFILE\\.cloudflared\\*.json\" ubuntu@SERVER:/tmp/"
    echo "       # di Ubuntu:"
    echo "       sudo mkdir -p /root/.cloudflared && sudo cp /tmp/*.json /root/.cloudflared/"
    echo "       sudo sed -i \"s|^credentials-file:.*|credentials-file: \$(ls -t /root/.cloudflared/*.json | head -n1)|\" /opt/pos-konter/deploy/cloudflared-ubuntu.yml"
    echo "       sudo systemctl restart cloudflared-pos-konter"
    echo "    B. BUAT BARU di Ubuntu (bila tunnel lama mau dibuang):"
    echo "      sudo cloudflared tunnel login"
    echo "      sudo cloudflared tunnel create $TUNNEL_NAME   # lewati bila tunnel sudah ada di dashboard"
    echo "      sudo cloudflared tunnel route dns $TUNNEL_NAME pos.pitujaya.my.id"
    echo "      sudo cloudflared tunnel route dns $TUNNEL_NAME api.pitujaya.my.id"
    echo "      sudo systemctl restart cloudflared-pos-konter"
    echo "      journalctl -u cloudflared-pos-konter -f"
    echo ""
    echo "    PENTING: setelah tunnel VPS jalan, MATIKAN tunnel di Windows"
    echo "    (tutup server.bat / tunnel-named.bat) agar tidak rebutan nama tunnel."
    # Coba start; bila belum login pasti gagal — itu normal, tampilkan warning saja
    systemctl restart cloudflared-pos-konter 2>/dev/null || echo "    (Belum login Cloudflare — selesaikan langkah login di atas, lalu restart service.)"
  else
    echo "    WARN: file deploy/cloudflared-pos-konter.service tidak ditemukan, lewati auto-install."
  fi
else
  echo "==> [7/7] Selesai."
fi

IP="$(hostname -I | awk '{print $1}')"
echo ""
echo "================ RINGKASAN ================"
echo " API health : $(curl -fsS http://127.0.0.1:8000/api/health 2>/dev/null || echo 'BELUM OK - cek logs')"
if [[ -n "$DOMAIN" && "$DOMAIN" != "_" ]]; then
  echo " Frontend   : https://$DOMAIN/  ( + http://$IP/ cadangan )"
  echo " API        : https://$DOMAIN/api/health"
else
  echo " Frontend   : http://$IP/  (nginx -> :8000)"
  echo " API        : http://$IP:8000/api/health  (langsung)  |  http://$IP/api/health (via nginx)"
fi
echo " Akun demo  : admin@konter.id / admin123 (superadmin)"
echo " Logs docker: docker compose logs -f   |   Logs native: journalctl -u pos-konter -f"
echo " Backup     : ./deploy/backup.sh  (otomatis tiap hari bila cron dipasang)"
echo "=========================================="
echo "LANGKAH TERAKHIR di HP/laptop kasir:"
echo " 1. Buka frontend di atas, login."
echo " 2. Bila dibuka dari file/Live Server: Pengaturan > Backend Server > isi API Base URL"
echo "    dengan http://$IP:8000/api (atau https domain), lalu Tes Koneksi."
echo " 3. Atau isi window.SERVISHP_SERVER di config.js sebelum upload (lihat DEPLOY-UBUNTU.md)."
