"""ServisHP Pro API — FastAPI + SQLite/Postgres. Production-ready Ubuntu."""
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

APP_VERSION = os.getenv("APP_VERSION", "1.1.0-ubuntu")
STARTED_AT = time.time()

# Dokumentasi API (Swagger/Redoc/OpenAPI) TIDAK boleh publik di production:
# skema API menjelaskan seluruh endpoint & parameter, memudahkan penyerang.
# Di development bisa dihidupkan lewat ENABLE_API_DOCS=1.
ENABLE_API_DOCS = os.getenv("ENABLE_API_DOCS", "").strip().lower() in ("1", "true", "yes", "on")

# Muat .env sederhana tanpa dependensi tambahan (aman bila python-dotenv tidak ada)
def _load_dotenv():
    try:
        from dotenv import load_dotenv  # type: ignore
        load_dotenv()
        return
    except Exception:
        pass
    # fallback manual: backend/.env
    env_file = Path(__file__).resolve().parent.parent / ".env"
    if env_file.exists():
        try:
            for line in env_file.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k, v = k.strip(), v.strip().strip("'").strip('"')
                if k and k not in os.environ:
                    os.environ[k] = v
        except Exception:
            pass


_load_dotenv()

from .database import Base, engine, SessionLocal
from .paths import UPLOAD_DIR as _SHARED_UPLOAD_DIR
from .routers import auth as auth_router
from .routers import users as users_router
from .routers import services as services_router
from .routers import settings as settings_router
from .routers import slides as slides_router
from .routers import spareparts as spareparts_router
from .routers import sales as sales_router
from .routers import expenses as expenses_router
from .routers import kas_sessions as kas_router
from .routers import ai_monitor as ai_monitor_router
from .seed import seed

app = FastAPI(
    title="ServisHP Pro API",
    version=APP_VERSION,
    # Hanya hidup kalau ENABLE_API_DOCS=1 (development).
    docs_url="/docs" if ENABLE_API_DOCS else None,
    redoc_url="/redoc" if ENABLE_API_DOCS else None,
    openapi_url="/openapi.json" if ENABLE_API_DOCS else None,
)

# CORS: bisa dikunci via env CORS_ORIGINS (koma-separated) untuk production.
# Default "*" agar tetap jalan di LAN / file:// / Live Server saat development.
def _cors_origins():
    raw = os.getenv("CORS_ORIGINS", "*").strip()
    if raw == "*" or not raw:
        return ["*"]
    return [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]


_CORS = _cors_origins()
# allow_credentials=True tidak boleh digabung allow_origins=["*"]
# (browser menolak + Starlette warning). Aktifkan credentials hanya bila
# origin dikunci spesifik via CORS_ORIGINS.
_ALLOW_CREDS = not (_CORS == ["*"])
app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS,
    allow_credentials=_ALLOW_CREDS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def _security_headers(request, call_next):
    resp = await call_next(request)
    # Header keamanan ringan (tidak merusak PWA / print)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "no-referrer-when-downgrade")
    return resp


def _ensure_columns(table: str, cols: dict[str, str]) -> None:
    """Tambah kolom yang belum ada. Bekerja di SQLite maupun Postgres.

    Sebelumnya migrasi memakai PRAGMA table_info -> hanya jalan di SQLite.
    Di Postgres PRAGMA gagal, error-nya ditelan diam-diam, kolom pun tidak
    pernah dibuat -> seluruh query yang memakai kolom itu jadi 500.
    Sekarang pakai SQLAlchemy Inspector (portabel) + ALTER TABLE standar.
    """
    from sqlalchemy import inspect

    try:
        insp = inspect(engine)
        if not insp.has_table(table):
            return
        existing = {c["name"] for c in insp.get_columns(table)}
        missing = {k: v for k, v in cols.items() if k not in existing}
        if not missing:
            return
        with engine.begin() as conn:
            for name, ddl in missing.items():
                try:
                    conn.exec_driver_sql(f'ALTER TABLE {table} ADD COLUMN "{name}" {ddl}')
                    print(f"[MIGRASI] kolom {table}.{name} ditambahkan")
                except Exception as e:
                    print(f"[WARN] gagal tambah kolom {table}.{name}: {e}")
    except Exception as e:
        print(f"[WARN] migrasi tabel {table}: {e}")


def _ensure_index(table: str, index: str, column: str) -> None:
    try:
        with engine.begin() as conn:
            conn.exec_driver_sql(f'CREATE INDEX IF NOT EXISTS "{index}" ON "{table}" ("{column}")')
    except Exception as e:
        print(f"[WARN] gagal buat index {index}: {e}")


try:
    Base.metadata.create_all(bind=engine)
    # Migrasi ringan: kolom baru yang belum ada di DB lama.
    _ensure_columns("spareparts", {
        "kategori": "VARCHAR(80) DEFAULT 'Lainnya'",
        "jenis": "VARCHAR(40) DEFAULT 'Sparepart'",
    })
    _ensure_index("spareparts", "ix_spareparts_kategori", "kategori")
    _ensure_index("spareparts", "ix_spareparts_jenis", "jenis")
    _ensure_columns("services", {
        "kasir": "VARCHAR(120) DEFAULT ''",
        "metode_bayar": "VARCHAR(30) DEFAULT 'tunai'",
        "wa_terkirim_at": "DATETIME",
        "wa_terkirim_oleh": "VARCHAR(120) DEFAULT ''",
    })
    _ensure_index("services", "ix_services_kasir", "kasir")
    _ensure_columns("expenses", {"jenis": "VARCHAR(20) DEFAULT 'biaya'"})
    _ensure_index("expenses", "ix_expenses_jenis", "jenis")
    _ensure_columns("cash_sessions", {"service_tunai": "INTEGER DEFAULT 0"})
    _ensure_columns("settings", {"akses": "JSON DEFAULT '{}'"})
    with SessionLocal() as _db:
        seed(_db)
except Exception as e:  # jangan bikin container crash-loop tanpa pesan
    print(f"[WARN] init DB/seed gagal: {e}")

app.include_router(auth_router.router, prefix="/api")
app.include_router(users_router.router, prefix="/api")
app.include_router(services_router.router, prefix="/api")
app.include_router(settings_router.router, prefix="/api")
app.include_router(slides_router.router, prefix="/api")
app.include_router(spareparts_router.router, prefix="/api")
app.include_router(sales_router.router, prefix="/api")
app.include_router(expenses_router.router, prefix="/api")
app.include_router(kas_router.router, prefix="/api")
app.include_router(ai_monitor_router.router, prefix="/api")

# Folder upload gambar headbar -> serve di /static/uploads.
# Path diambil dari app.paths supaya PENTING sama dengan folder yang dipakai
# router slides saat menulis file. Kalau berbeda, hasil upload selalu 404.
UPLOAD_DIR = _SHARED_UPLOAD_DIR
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")


@app.get("/api/health")
def health(response: Response):
    db_ok = True
    db_error = None
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
    except Exception as e:
        db_ok = False
        db_error = str(e)[:200]
    if not db_ok:
        # Healthcheck harus benar-benar gagal kalau DB tidak bisa dipakai.
        response.status_code = 503
    return {
        # ok mencerminkan kondisi DB, bukan selalu true. Kalau DB rusak,
        # healthcheck docker harus gagal supaya container ditandai tidak sehat.
        "ok": db_ok,
        "app": "ServisHP Pro API",
        "version": APP_VERSION,
        "db_ok": db_ok,
        "db_error": db_error,
        "uptime_sec": int(time.time() - STARTED_AT),
        "time": datetime.now(timezone.utc).isoformat(),
    }


# Sajikan frontend statis (index.html, script.js, style.css).
# Urutan pencarian (paling cocok untuk Ubuntu):
#   1. FRONTEND_DIR env (mis. /app/frontend di docker)
#   2. folder project di atas backend/ (jalur dev Windows/Linux)
#   3. /app/frontend (konvensi docker image)
FRONTEND_CANDIDATES = [
    Path(os.getenv("FRONTEND_DIR", "") or "__EMPTY__"),
    Path(__file__).resolve().parent.parent.parent,
    Path("/app/frontend"),
]
FRONTEND_DIR = next((p for p in FRONTEND_CANDIDATES if p.name != "__EMPTY__" and (p / "index.html").exists()), None)
LANDING_DIR = Path(os.getenv("LANDING_DIR", "") or (Path(__file__).resolve().parent.parent.parent / "landing"))
LANDING_HOSTS = {"pitujaya.my.id", "www.pitujaya.my.id"}
if FRONTEND_DIR is not None:
    @app.get("/", include_in_schema=False)
    @app.get("/index.html", include_in_schema=False)
    def root_page(request: Request):
        host = (request.headers.get("host", "").split(":")[0] or "").lower()
        if host == "www.pitujaya.my.id":
            return RedirectResponse("https://pitujaya.my.id/", status_code=308)
        if host in LANDING_HOSTS:
            landing_index = LANDING_DIR / "index.html"
            if landing_index.exists():
                return FileResponse(landing_index, media_type="text/html")
        return FileResponse(FRONTEND_DIR / "index.html", media_type="text/html")

    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
