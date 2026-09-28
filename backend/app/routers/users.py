"""CRUD /api/users — khusus Super Admin (kecuali /me)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas
from ..auth import (
    norm_email, norm_phone, hash_password, get_current_user, require_superadmin,
)

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[schemas.UserOut])
def list_users(_: models.User = Depends(require_superadmin), db: Session = Depends(get_db)):
    return db.query(models.User).order_by(models.User.id.asc()).all()


@router.post("", response_model=schemas.UserOut)
def create_user(body: schemas.UserCreateIn, _: models.User = Depends(require_superadmin), db: Session = Depends(get_db)):
    email = norm_email(body.email) or None
    hp = norm_phone(body.hp) or None
    if not (body.nama or "").strip():
        raise HTTPException(400, "Nama wajib")
    if not email and not hp:
        raise HTTPException(400, "Isi email atau HP")
    if email and db.query(models.User).filter(models.User.email == email).first():
        raise HTTPException(400, "Email sudah dipakai")
    if hp and db.query(models.User).filter(models.User.hp == hp).first():
        raise HTTPException(400, "HP sudah dipakai")
    u = models.User(nama=body.nama.strip(), email=email, hp=hp,
                    password_hash=hash_password(body.password),
                    role=body.role if body.role in ("kasir", "admin", "superadmin") else "kasir")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


@router.patch("/{user_id}/role", response_model=schemas.UserOut)
def change_role(user_id: int, body: schemas.RoleUpdateIn,
                me: models.User = Depends(require_superadmin), db: Session = Depends(get_db)):
    if body.role not in ("kasir", "admin", "superadmin"):
        raise HTTPException(400, "Role tidak valid")
    u = db.get(models.User, user_id)
    if not u:
        raise HTTPException(404, "User tidak ditemukan")
    if u.id == me.id:
        raise HTTPException(400, "Tidak bisa ubah role sendiri")
    if u.role == "superadmin" and body.role != "superadmin":
        n_super = db.query(models.User).filter(models.User.role == "superadmin").count()
        if n_super <= 1:
            raise HTTPException(400, "Minimal 1 Super Admin harus ada")
    u.role = body.role
    db.commit()
    db.refresh(u)
    return u


@router.post("/{user_id}/reset-password")
def reset_password(user_id: int, body: schemas.ResetPwIn,
                   _: models.User = Depends(require_superadmin), db: Session = Depends(get_db)):
    u = db.get(models.User, user_id)
    if not u:
        raise HTTPException(404, "User tidak ditemukan")
    u.password_hash = hash_password(body.new_password)
    db.commit()
    return {"ok": True}


@router.delete("/{user_id}")
def delete_user(user_id: int, me: models.User = Depends(require_superadmin), db: Session = Depends(get_db)):
    # butuh current_user juga untuk cegah hapus diri sendiri -> pakai require_superadmin + get_current_user
    u = db.get(models.User, user_id)
    if not u:
        raise HTTPException(404, "User tidak ditemukan")
    if u.id == me.id:
        raise HTTPException(400, "Tidak bisa hapus akun sendiri")
    if u.role == "superadmin":
        n_super = db.query(models.User).filter(models.User.role == "superadmin").count()
        if n_super <= 1:
            raise HTTPException(400, "Tidak bisa hapus satu-satunya Super Admin")
    db.delete(u)
    db.commit()
    return {"ok": True}
