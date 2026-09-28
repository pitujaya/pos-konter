"""POST /api/auth/register, /login, GET /me, PUT /password, POST /forgot."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas
from ..auth import (
    norm_email, norm_phone, is_email, hash_password, verify_password,
    create_token, get_current_user,
)

router = APIRouter(prefix="/auth", tags=["auth"])
VALID_ROLES = ("kasir", "admin", "superadmin")


def find_user(db: Session, identifier: str) -> models.User | None:
    identifier = (identifier or "").strip()
    if is_email(identifier):
        return db.query(models.User).filter(models.User.email == norm_email(identifier)).first()
    # bisa email ATAU no HP
    by_email = db.query(models.User).filter(models.User.email == norm_email(identifier)).first()
    if by_email:
        return by_email
    return db.query(models.User).filter(models.User.hp == norm_phone(identifier)).first()


@router.post("/register", response_model=schemas.TokenOut)
def register(body: schemas.RegisterIn, db: Session = Depends(get_db)):
    nama = (body.nama or "").strip()
    email = norm_email(body.email) or None
    hp = norm_phone(body.hp) or None
    role = body.role if body.role in VALID_ROLES else "kasir"
    if not nama:
        raise HTTPException(400, "Nama wajib diisi")
    if not email and not hp:
        raise HTTPException(400, "Isi minimal email ATAU nomor HP")
    if email and email in ("", None):
        email = None
    if hp in ("", None):
        hp = None
    if email and db.query(models.User).filter(models.User.email == email).first():
        raise HTTPException(400, "Email sudah terdaftar")
    if hp and db.query(models.User).filter(models.User.hp == hp).first():
        raise HTTPException(400, "No. HP sudah terdaftar")
    u = models.User(nama=nama, email=email, hp=hp, password_hash=hash_password(body.password), role=role)
    db.add(u)
    db.commit()
    db.refresh(u)
    token = create_token(u.id, True)
    return {"access_token": token, "user": u}


@router.post("/login", response_model=schemas.TokenOut)
def login(body: schemas.LoginIn, db: Session = Depends(get_db)):
    u = find_user(db, body.identifier)
    if not u or not verify_password(body.password, u.password_hash):
        raise HTTPException(401, "Email/No. HP atau password salah")
    token = create_token(u.id, body.remember)
    return {"access_token": token, "user": u}


@router.get("/me", response_model=schemas.UserOut)
def me(user: models.User = Depends(get_current_user)):
    return user


@router.put("/password")
def change_password(body: schemas.PasswordChangeIn, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    if body.confirm and body.new_password != body.confirm:
        raise HTTPException(400, "Konfirmasi password tidak sama")
    user.password_hash = hash_password(body.new_password)
    db.commit()
    return {"ok": True}


@router.post("/forgot")
def forgot(identifier: str, new_password: str, db: Session = Depends(get_db)):
    """Reset simpel tanpa email (sesuai frontend lama pakai prompt)."""
    if len(new_password or "") < 6:
        raise HTTPException(400, "Password minimal 6 karakter")
    u = find_user(db, identifier)
    if not u:
        raise HTTPException(404, "Akun tidak ditemukan")
    u.password_hash = hash_password(new_password)
    db.commit()
    return {"ok": True}
