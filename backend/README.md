# ServisHP Pro — Backend FastAPI + SQLite

Backend lengkap untuk frontend `POS KONTER` (index.html / script.js / api.js).
Mendukung auth JWT + role (kasir / admin / superadmin), CRUD service HP,
settings konter, manajemen user, dan dashboard. Frontend tetap bisa offline
(LocalStorage) kalau server mati.

## 1. Install & jalan

```bat
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

atau di PowerShell:

```powershell
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```

Lalu buka:

- Frontend tersambung penuh: **http://localhost:8000/**
- Dokumentasi API (Swagger): **http://localhost:8000/docs**
- Health check: **http://localhost:8000/api/health**

> Backend otomatis serve `index.html` di root (`/`), jadi cukup buka
> `http://localhost:8000` — tidak perlu Live Server / file://.

## 2. Database

- Default SQLite file: `backend/servishp.db` (dibuat otomatis + seed).
- Ganti via env `DATABASE_URL`, contoh:
  `DATABASE_URL=sqlite:///./servishp.db`
- Seed otomatis saat start:
  - `admin@konter.id / admin123` (superadmin)
  - `admin.toko@konter.id / admin123` (admin)
  - `kasir.toko@konter.id / kasir123` (kasir)
  - 2 contoh service + setting konter default.

## 3. Struktur

```
backend/
  requirements.txt
  .env.example
  run.bat
  app/
    main.py        -> FastAPI app + CORS + static frontend
    database.py    -> engine SQLite + Session
    models.py      -> User, Service, ServiceHistory, Setting
    schemas.py     -> Pydantic request/response
    auth.py        -> bcrypt + JWT + role guard
    seed.py        -> data awal
    routers/
      auth.py      -> register/login/me/password/forgot
      services.py  -> CRUD service + stats
      kas_sessions.py -> buka/tutup sesi kasir (shift) + rekap kas
      users.py     -> kelola user (superadmin)
      settings.py  -> profil konter + teknisi + merk
```

## 4. API ringkas

Auth: kirim header `Authorization: Bearer <token>` setelah login.

- `POST /api/auth/register` {nama,email,hp,password} -> **selalu role `kasir`**
  (role admin/superadmin hanya bisa dibuat Super Admin lewat `POST /api/users`)
- `POST /api/auth/login` {identifier,password,remember} -> {access_token,user}
- `GET /api/auth/me`
- `PUT /api/auth/password` {new_password}
- `GET /api/services?q=&status=Semua&sort=baru&skip=0&limit=500`
- `POST /api/services` (kasir+ bisa input, butuh sesi kasir terbuka)
- `GET /api/services/{id}`
- `PUT /api/services/{id}` (admin+)
- `PATCH /api/services/{id}/status` (semua role login; status `Diambil` butuh sesi kasir)
- `DELETE /api/services/{id}` (admin+)
- `POST /api/services/purge` {scope:"diambil"|"all"} (hapus massal; `all` = superadmin)
- `GET /api/stats/dashboard`

Sesi kasir (shift) — transaksi service/penjualan/pengeluaran ditolak (409) bila
sesi belum dibuka:

- `POST /api/kas/open` {modal_awal,catatan} -> sesi terbuka (1 per kasir)
- `POST /api/kas/{id}/close` {kas_akhir,catatan} -> rekap + selisih kas
- `GET /api/kas/current` -> sesi terbuka + rekap live (null bila kas tutup)
- `GET /api/kas?scope=auto|mine|all&limit=50` -> riwayat sesi
  (`scope=all` hanya untuk admin/superadmin)

`kas_sistem = modal_awal + penjualan_tunai + kas_service_tunai - pengeluaran`;
`selisih = kas_akhir - kas_sistem`.
- `GET/PUT /api/settings` (PUT admin+)
- `POST/DELETE /api/settings/teknisi[/{index}]`, `/merk[/{index}]` (admin+)
- `GET/POST /api/users`, `PATCH /api/users/{id}/role`, `POST /api/users/{id}/reset-password`, `DELETE /api/users/{id}` (superadmin)
- `PATCH /api/spareparts/{id}/stock` {delta,alasan} + `GET /api/spareparts/{id}/stock-log` (jejak audit stok)

### Catatan keamanan

- Pendaftaran publik **tidak bisa** membuat akun admin/superadmin.
- Reset password publik (`POST /api/auth/forgot`) **dinonaktifkan** (410).
  Alur resmi: Super Admin mereset lewat `POST /api/users/{id}/reset-password`,
  atau user yang sudah login mengganti sendiri lewat `PUT /api/auth/password`.
- `SECRET_KEY` **wajib** diisi di `backend/.env` (min. 32 karakter). Kalau kosong,
  backend membuat kunci acak dan menyimpannya di `backend/.secret_key`
  (gitignored) — bukan konstanta publik yang ada di repo.
- Endpoint AI (`/api/ai/providers`, `/api/ai/clients`) hanya untuk admin.
  Kunci API client tidak pernah dikirim mentah; tampilkan sekali saat dibuat
  atau lewat `GET /api/ai/clients/{id}/key` (superadmin).
- `UPLOAD_DIR` dibaca dari env oleh **semua** modul (lihat `app/paths.py`),
  jadi file upload dan file yang disajikan selalu di folder yang sama.

## 5. Test

```bat
cd backend
pip install -r requirements-dev.txt
python -m pytest tests -q
```

Test memakai database SQLite sementara yang terpisah — data produksi tidak
pernah tersentuh.


## 5. Frontend

- `api.js` otomatis deteksi base URL (`location.origin/api` kalau diserve backend,
  fallback `http://127.0.0.1:8000/api`). Bisa dioverride via localStorage
  `servishp_api_base` atau menu Pengaturan > Backend Server.
- `script.js` backend-first: login/register/service/setting/user coba ke API dulu,
  kalau gagal/offline fallback ke LocalStorage lama.
- Indikator koneksi ada di Pengaturan > Backend Server + tombol Tes Koneksi.

## 6. Production notes

- Ganti `SECRET_KEY` di env, jangan pakai default.
- Batasi `CORS_ORIGINS` ke domain konter.
- Backup rutin file `servishp.db`.
- Untuk Postgres/MySQL tinggal ganti `DATABASE_URL` + install driver.
