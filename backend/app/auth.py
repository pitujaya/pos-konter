"""Auth: normalisasi, bcrypt, JWT, dependency role."""
import os
import re
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .database import get_db
from . import models

ALGO = "HS256"
EXPIRE_DAYS = int(os.getenv("ACCESS_TOKEN_EXPIRE_DAYS", "7"))
bearer = HTTPBearer(auto_error=False)


def _load_secret_key() -> str:
    """Ambil SECRET_KEY dari env. Kalau tidak ada -> generate acak & simpan lokal.

    Kenapa tidak pakai konstanta default yang hardcoded di repo?
    Konstanta yang ada di git = kunci publik. Siapa pun bisa memalsukan token
    admin/superadmin hanya dengan knowing repo ini. Jadi kalau env kosong kita
    membuat kunci acak per-install dan menyimpannya di file lokal (gitignored)
    supaya token tetap valid setelah restart.
    """
    env = (os.getenv("SECRET_KEY") or "").strip()
    if env:
        if len(env) < 32:
            raise RuntimeError(
                "SECRET_KEY terlalu pendek (min 32 karakter). "
                "Set SECRET_KEY di backend/.env sebelum production."
            )
        return env

    from .paths import BACKEND_DIR

    key_file = BACKEND_DIR / ".secret_key"
    try:
        if key_file.exists():
            val = key_file.read_text(encoding="utf-8").strip()
            if len(val) >= 32:
                return val
    except Exception:
        pass

    val = secrets.token_urlsafe(48)
    try:
        key_file.write_text(val, encoding="utf-8")
        try:
            os.chmod(key_file, 0o600)
        except Exception:
            pass
    except Exception:
        pass
    print("[WARN] SECRET_KEY tidak diset -> pakai kunci acak di backend/.secret_key. "
          "Set SECRET_KEY eksplisit di .env untuk production.")
    return val


SECRET_KEY = _load_secret_key()


def norm_email(s: str | None) -> str:
    return (s or "").strip().lower()


def norm_phone(s: str | None) -> str:
    p = re.sub(r"[\s\-.()]", "", str(s or ""))
    if p.startswith("+62"):
        p = "0" + p[3:]
    return p


def is_email(s: str) -> bool:
    return bool(re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", (s or "").strip()))


def hash_password(pw: str) -> str:
    """bcrypt hanya memproses 72 byte pertama. Potong eksplisit supaya perilakunya
    konsisten di semua versi bcrypt (beberapa versi raise ValueError > 72 byte)."""
    raw = (pw or "").encode("utf-8")[:72]
    return bcrypt.hashpw(raw, bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw((pw or "").encode("utf-8")[:72], hashed.encode())
    except Exception:
        return False


def create_token(user_id: int, remember: bool = True) -> str:
    days = EXPIRE_DAYS if remember else 1
    exp = datetime.now(timezone.utc) + timedelta(days=days)
    return jwt.encode({"sub": str(user_id), "exp": exp}, SECRET_KEY, algorithm=ALGO)


def decode_token(token: str) -> int:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGO])
        return int(payload["sub"])
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token tidak valid / kedaluwarsa")


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> models.User:
    if not creds or not creds.credentials:
        raise HTTPException(status_code=401, detail="Butuh login (token)")
    uid = decode_token(creds.credentials)
    user = db.get(models.User, uid)
    if not user:
        raise HTTPException(status_code=401, detail="User tidak ditemukan")
    return user


def require_roles(*roles: str):
    def guard(user: models.User = Depends(get_current_user)) -> models.User:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="Akses ditolak untuk role ini")
        return user

    return guard


require_admin = require_roles("admin", "superadmin")
require_superadmin = require_roles("superadmin")
