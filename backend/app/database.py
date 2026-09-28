"""Database SQLite + SQLAlchemy session.

Production-ready untuk Ubuntu:
- DATABASE_URL bisa dari env / .env (sqlite, postgres, mysql).
- Untuk sqlite relatif (sqlite:///./servishp.db), path di-resolve absolut
  terhadap folder backend/ agar aman saat dijalankan via systemd / docker
  dari working directory mana pun.
- Folder database otomatis dibuat.
"""
import os
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

_BACKEND_DIR = Path(__file__).resolve().parent.parent  # backend/


def _ensure_parent(p: Path) -> Path:
    """Buat folder parent; bila gagal (mis. /data milik root), fallback ke backend dir."""
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        return p
    except Exception:
        fallback = (_BACKEND_DIR / p.name).resolve()
        try:
            fallback.parent.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass
        return fallback


def _resolve_db_url(raw: str) -> str:
    raw = (raw or "").strip() or "sqlite:///./servishp.db"
    if raw.startswith("sqlite:"):
        # Pisahkan path sqlite dari prefix
        # Bentuk umum: sqlite:///./servishp.db | sqlite:////abs/path.db | sqlite:///abs/path.db
        prefix = "sqlite:///"
        path_part = raw[len(prefix):] if raw.startswith(prefix) else raw.split("sqlite:", 1)[1]
        p = Path(path_part)
        if not p.is_absolute():
            # relatif -> jadikan absolut terhadap backend dir (atau /data bila ada, untuk docker volume)
            # Prioritas: /data (konvensi docker) bila folder itu ada & bisa ditulis
            data_dir = Path("/data")
            base = _BACKEND_DIR
            try:
                if data_dir.is_dir():
                    # uji tulis (tanpa bikin file permanen)
                    test = data_dir / ".writetest"
                    try:
                        test.touch(exist_ok=True)
                        test.unlink(missing_ok=True)
                        base = data_dir
                    except Exception:
                        base = _BACKEND_DIR
            except Exception:
                pass
            p = _ensure_parent((base / path_part.lstrip("./")).resolve())
            return f"sqlite:///{p.as_posix()}"
        else:
            p = _ensure_parent(p.resolve())
            return f"sqlite:///{p.as_posix()}"
    return raw


DATABASE_URL = _resolve_db_url(os.getenv("DATABASE_URL", "sqlite:///./servishp.db"))

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
