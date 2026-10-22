"""Path konfigurasi yang dipakai bersama beberapa modul.

PENTING: UPLOAD_DIR harus di-resolve SATU kali di sini supaya router (penulis
file) dan main.py (penyaji file) selalu menunjuk direktori yang sama.
Kalau salah satu membaca env dan yang lain tidak, file hasil upload tidak akan
pernah ditemukan saat disajikan -> 404 permanen.
"""
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent  # backend/
APP_DIR = Path(__file__).resolve().parent              # backend/app/


def _upload_dir() -> Path:
    raw = (os.getenv("UPLOAD_DIR") or "").strip()
    p = Path(raw) if raw else (APP_DIR / "uploads")
    try:
        p.mkdir(parents=True, exist_ok=True)
    except Exception:
        # mis. /data milik root -> fallback ke folder app yang pasti bisa ditulis
        p = APP_DIR / "uploads"
        p.mkdir(parents=True, exist_ok=True)
    return p


UPLOAD_DIR = _upload_dir()
