"""ServisHP Pro API — FastAPI + SQLite/Postgres. Production-ready Ubuntu."""
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

APP_VERSION = os.getenv("APP_VERSION", "1.1.0-ubuntu")
STARTED_AT = time.time()

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
from .routers import auth as auth_router
from .routers import users as users_router
from .routers import services as services_router
from .routers import settings as settings_router
from .routers import slides as slides_router
from .routers import spareparts as spareparts_router
from .seed import seed

app = FastAPI(title="ServisHP Pro API", version=APP_VERSION)

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


try:
    Base.metadata.create_all(bind=engine)
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

# Folder upload gambar headbar -> serve di /static/uploads (hanya folder uploads)
# Bisa dioverride via UPLOAD_DIR (mis. /data/uploads di docker)
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", str(Path(__file__).resolve().parent / "uploads")))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")


@app.get("/api/health")
def health():
    db_ok = True
    db_error = None
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
    except Exception as e:
        db_ok = False
        db_error = str(e)[:200]
    return {
        "ok": True,
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
if FRONTEND_DIR is not None:
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
