# Panduan SSH ke Server Produksi (POS Konter)

> **INI TEMPLATE.** Ganti semua `<...>` dengan data server sebenarnya.
> Jangan commit kredensial ke repo.

## 1. Data yang perlu diisi

| Placeholder     | Isi (contoh)                   |
|-----------------|--------------------------------|
| `<IP_SERVER>`   | `203.0.113.10`                 |
| `<DOMAIN>`      | `pos.domainmu.id` (opsional)   |
| `<PORT>`        | `22` (default) atau custom     |
| `<USER_DEPLOY>` | `deploy` / `ubuntu` / `root`    |

## 2. Prasyarat

- **OpenSSH client** di komputer lokal: Windows 10/11 → *Settings → Apps →
  Optional features → OpenSSH Client* (cek `ssh -V`); Linux/macOS sudah bawaan.
- **Server Ubuntu** dengan `sshd` aktif: `sudo systemctl enable --now ssh`
  dan `sudo ufw allow <PORT>/tcp`.
- Akun deploy sudah ada di server dan punya hak `sudo`.
- Kunci SSH (opsional tapi disarankan): `ssh-keygen -t ed25519` lalu
  `ssh-copy-id -p <PORT> <USER_DEPLOY>@<IP_SERVER>`.

## 3. Koneksi ke server

```bash
ssh <USER_DEPLOY>@<IP_SERVER> -p <PORT>     # via IP
ssh <USER_DEPLOY>@<DOMAIN> -p <PORT>        # via domain
ssh -p <PORT> <USER_DEPLOY>@<IP_SERVER> "hostname; uptime"   # cek cepat
```

| Gejala | Penyebab / Solusi |
|--------|-------------------|
| `Permission denied (publickey)` | Kunci belum dikirim: `ssh-copy-id -p <PORT> user@ip` |
| `Connection timed out` | Port/firewall: `sudo ufw status`, `ss -tlnp \| grep <PORT>` |
| `REMOTE HOST IDENTIFICATION HAS CHANGED` | `ssh-keygen -R "<IP_SERVER>"` lalu coba lagi |
| `Permission denied (sudo)` | `sudo usermod -aG sudo <USER_DEPLOY>` |

## 4. Folder deploy di server

`/opt/pos-konter/` = SOURCE (repo git: frontend + backend).
- `deploy/` → `update.sh` | `backup.sh` | `auto-update-cron.sh`
- `backend/` → FastAPI + database (tidak ter-commit), `index.html`, `script.js` → frontend
- Config nginx: `/etc/nginx/sites-available/pos-konter`
- Log nginx: `/var/log/nginx/pos-konter.access.log`
- Log auto-update: `/var/log/pos-konter-autoupdate.log`
- Backup: `/var/backups/pos-konter/`

## 5. Update aplikasi

```bash
cd /opt/pos-konter
sudo ./deploy/update.sh
```

Script: `git pull` → bump versi aset (`?v=` di `index.html`, cache busting browser)
→ rebuild docker / restart systemd → health check. Auto-update tiap 5 menit:
`sudo tail -f /var/log/pos-konter-autoupdate.log`. Ubah config nginx →
`sudo nginx -t && sudo systemctl reload nginx`.

## 6. Cek log

```bash
# Native (systemd)
sudo journalctl -u pos-konter -n 50
sudo journalctl -u pos-konter -f            # streaming
sudo systemctl status pos-konter

# Docker
cd /opt/pos-konter && docker compose ps
docker compose logs --tail 50
docker compose logs -f pos-konter            # streaming

# Nginx
sudo tail -50 /var/log/nginx/pos-konter.error.log
```

## 7. Cek kesehatan (health check)

```bash
curl http://127.0.0.1:8000/api/health      # hasil: {"status":"ok", ...}
curl https://<DOMAIN>/api/health            # dari luar (via nginx)

# Skema API tidak boleh publik (harus 404)
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1/openapi.json
```

## 8. Backup database

```bash
cd /opt/pos-konter
sudo ./deploy/backup.sh
# hasil: /var/backups/pos-konter/pos-konter-<tanggal>.tar.gz

# backup harian otomatis
sudo crontab -e
# tambahkan: 0 2 * * * /opt/pos-konter/deploy/backup.sh
```

Restore manual:

```bash
sudo mkdir -p /tmp/restore
sudo tar -xzf /var/backups/pos-konter/pos-konter-<tanggal>.tar.gz -C /tmp/restore
# salin servishp.db ke lokasi DB + folder uploads/ ke UPLOAD_DIR, lalu:
sudo systemctl restart pos-konter     # atau: docker compose up -d
```

## 9. Checklist harian

- [ ] `curl http://127.0.0.1:8000/api/health` → OK
- [ ] `docker compose ps` / `systemctl status pos-konter` → running
- [ ] `sudo tail -20 /var/log/pos-konter-autoupdate.log` → tidak ada ERROR
- [ ] `/var/backups/pos-konter/` berisi backup terbaru
