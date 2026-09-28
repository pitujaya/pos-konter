# DEPLOY KE SERVER UBUNTU — ServisHP Pro (POS Konter)
Panduan Bahasa Indonesia, dari Windows ke VPS/server Ubuntu 22.04/24.04.
Hasil akhir: frontend + backend jalan di `http://IP-SERVER/` (atau `https://domain/`),
semua HP/laptop kasir otomatis tersambung. Tetap bisa offline (LocalStorage) bila server mati.

## 0. Yang kamu butuhkan
- Server Ubuntu (VPS lokal / cloud) + user `root` atau `sudo`. Catat **IP_SERVER**.
- (Opsional tapi disarankan) Domain, mis. `pos.pitujaya.my.id`, dengan DNS A → IP_SERVER.
- Project ini di `H:\POS KONTER` (sudah siap: Dockerfile, docker-compose, deploy script).

## 1. Kirim project ke Ubuntu (dari Windows)
Pilih SATU cara:

**A. Via SCP (paling gampang, pakai PowerShell):**
```powershell
# Edit dulu IP + user di dalam file ini, lalu jalankan:
.\deploy\kirim-ke-ubuntu.ps1
```
Script itu otomatis: kompres project → scp ke `/opt/pos-konter` → extract di server.

**B. Manual SCP:**
```powershell
scp -r "H:\POS KONTER" root@IP_SERVER:/opt/pos-konter
```

**C. Via Git (bila project sudah di GitHub):**
```bash
# di Ubuntu:
sudo apt update && sudo apt install -y git
sudo mkdir -p /opt/pos-konter && sudo chown $USER:$USER /opt/pos-konter
git clone <URL-REPO> /opt/pos-konter
cd /opt/pos-konter
```

## 2. Jalankan installer di Ubuntu (SATU perintah)
```bash
cd /opt/pos-konter
chmod +x deploy/*.sh
# A. Paling disarankan — Docker:
sudo ./deploy/deploy-ubuntu.sh

# B. Dengan domain + HTTPS otomatis:
sudo ./deploy/deploy-ubuntu.sh --domain=pos.pitujaya.my.id --email=admin@pitujaya.my.id

# C. Tanpa Docker (venv + systemd + nginx):
sudo ./deploy/deploy-ubuntu.sh --native
```
Script otomatis: install dependensi → buatkan `backend/.env` (SECRET_KEY acak) →
jalankan backend → pasang nginx `:80 → :8000` → buka firewall → cek `/api/health`.

Cek manual:
```bash
curl http://127.0.0.1:8000/api/health
# docker: docker compose logs -f
# native : journalctl -u pos-konter -f
```

## 3. Sambungkan frontend (pilih yang paling cocok)
Kamu TIDAK perlu setting tiap HP bila pakai opsi 1.

| Cara | Kapan dipakai | Langkah |
|---|---|---|
| **1. Buka dari server langsung (DISARANKAN)** | Selalu, bila memungkinkan | Buka `http://IP-SERVER/` (atau `https://domain/`) di HP/laptop. Frontend disajikan backend yang sama → `api.js` otomatis pakai origin yang sama. SELESAI. |
| **2. Kunci via config.js (sekali setting)** | Frontend dibuka dari file/hosting lain tapi server tetap | Di Windows edit `config.js`: `window.SERVISHP_SERVER = "http://IP-SERVER:8000";` (atau `https://domain`), upload ulang ke server. Semua perangkat otomatis ikut. |
| **3. Per perangkat via Pengaturan** | Darurat / kasir jauh | Di HP: Pengaturan → Backend Server → isi API Base URL `http://IP-SERVER:8000/api` → Simpan URL → Tes Koneksi (hijau = OK). |
| **4. Via query URL** | Tes cepat | Buka `http://IP-SERVER/?api=http://IP-SERVER:8000` — otomatis disimpan. |

> Port: via nginx pakai `:80` (tanpa port). Langsung ke backend pakai `:8000`.
> Pastikan firewall/server membuka port yang dipakai + HP satu jaringan (bila server lokal).

## 4. HTTPS (bila punya domain)
Otomatis bila installer dipanggil dengan `--domain --email` (certbot).
Manual:
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d pos.pitujaya.my.id --redirect
```
Lalu kunci CORS bila mau (di `backend/.env`):
```
CORS_ORIGINS=https://pos.pitujaya.my.id
```
Restart: `docker compose restart` atau `sudo systemctl restart pos-konter`.

## 5. Cloudflare Tunnel (opsional, bila IP tidak publik)
Tetap bisa pakai tunnel lama dari Windows, ATAU pindahkan ke Ubuntu:
```bash
# di Ubuntu:
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install -y cloudflared
cloudflared tunnel login
cloudflared tunnel create pos-konter
cloudflared tunnel route dns pos-konter pos.pitujaya.my.id
# sesuaikan deploy/cloudflared-ubuntu.yml lalu:
cloudflared tunnel --config deploy/cloudflared-ubuntu.yml run pos-konter
```
Jangan jalankan tunnel Windows + Ubuntu bersamaan untuk hostname yang sama.

## 6. Operasional harian
```bash
# Update setelah upload versi baru:
sudo ./deploy/update.sh

# Backup manual:
sudo ./deploy/backup.sh
# Backup otomatis harian jam 2 pagi:
sudo crontab -e
# tambah: 0 2 * * * /opt/pos-konter/deploy/backup.sh

# Ganti SECRET_KEY / password DB: edit backend/.env lalu restart.
# Lihat antrian: curl http://127.0.0.1:8000/api/health
```

## 7. Troubleshooting cepat
| Gejala | Penyebab umum | Perintah |
|---|---|---|
| `Tidak bisa menghubungi ...` di HP | Salah IP/port, beda WiFi, firewall | `curl http://IP:8000/api/health` dari HP; `sudo ufw status`; `docker compose logs` |
| Hijau di server, merah di HP | Frontend dibuka via `file://`/Live Server + API beda origin | Isi Pengaturan → API Base URL dengan IP Ubuntu, atau buka via `http://IP/` |
| 502 Bad Gateway (nginx) | Backend belum hidup | `docker compose ps` / `systemctl status pos-konter`; `curl 127.0.0.1:8000/api/health` |
| Upload gambar gagal | `client_max_body_size` / izin folder | Cek nginx conf + `ls -la backend/app/uploads` |
| DB hilang setelah rebuild | Volume tidak kepasang | `docker volume ls`; backup ada di `/var/backups/pos-konter/` |
| Lupa SECRET_KEY | — | `cat backend/.env`; jangan share ke publik |

## 8. Struktur file baru (referensi)
```
Dockerfile                  # image production (frontend + backend satu pintu :8000)
docker-compose.yml          # service + volume pos-konter-data + healthcheck
config.js                   # KUNCI server sekali (window.SERVISHP_SERVER)
api.js                      # auto-detect: ?api= > localStorage > config.js > same-origin
deploy/
  deploy-ubuntu.sh          # installer satu perintah (docker/native + nginx + https)
  update.sh                 # update cepat
  backup.sh                 # backup sqlite + uploads (+ cron)
  kirim-ke-ubuntu.ps1       # kirim dari Windows via SCP
  pos-konter.service        # systemd (mode native)
  nginx-pos-konter.conf     # reverse proxy :80 -> :8000
  cloudflared-ubuntu.yml    # contoh tunnel di Ubuntu
```

## 9. Keamanan checklist (production)
- [x] `SECRET_KEY` acak 64 hex (otomatis oleh installer)
- [ ] `CORS_ORIGINS` dikunci ke domain (bila sudah HTTPS)
- [ ] UFW aktif, hanya 22/80/443 (+8000 bila perlu akses langsung)
- [ ] Backup harian via cron + sesekali download `.tar.gz`
- [ ] Ganti password demo `admin123/kasir123` setelah deploy (menu Pengguna)
- [ ] Update rutin: `apt update && apt upgrade` + `./deploy/update.sh`
