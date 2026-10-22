"""GET/PUT /api/settings + kelola teknisi & merk."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas
from ..auth import get_current_user, require_admin

router = APIRouter(prefix="/settings", tags=["settings"])


def get_or_create(db: Session) -> models.Setting:
    s = db.get(models.Setting, 1)
    if not s:
        s = models.Setting(id=1)
        db.add(s)
        db.commit()
        db.refresh(s)
    # Default lama harus DISIMPAN. Sebelumnya hanya di-set di memori tanpa
    # commit -> kolom tetap NULL di DB dan default dipasang ulang tiap
    # request (dan diam-diam ikut ter-flush di commit berikutnya).
    dirty = False
    if s.teknisi is None:
        s.teknisi = ["Andi", "Budi"]
        dirty = True
    if s.merk is None:
        s.merk = ["Samsung", "iPhone", "Xiaomi", "Oppo", "Vivo", "Realme", "Infinix"]
        dirty = True
    if dirty:
        db.commit()
        db.refresh(s)
    return s


def _out(s: models.Setting) -> dict:
    return {"nama": s.nama, "alamat": s.alamat, "telp": s.telp, "nota": s.nota,
            "teknisi": s.teknisi or [], "merk": s.merk or [], "akses": s.akses or {}}


@router.get("", response_model=schemas.SettingOut)
def get_settings(db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    return _out(get_or_create(db))


@router.put("", response_model=schemas.SettingOut)
def update_settings(body: schemas.SettingUpdateIn, db: Session = Depends(get_db),
                    user: models.User = Depends(require_admin)):
    s = get_or_create(db)
    if body.nama is not None:
        s.nama = body.nama
    if body.alamat is not None:
        s.alamat = body.alamat
    if body.telp is not None:
        s.telp = body.telp
    if body.nota is not None:
        s.nota = body.nota
    if body.akses is not None:
        # Hanya Super Admin yang boleh mengubah hak akses.
        if user.role != "superadmin":
            raise HTTPException(403, "Hak akses hanya bisa diubah Super Admin")
        s.akses = {str(k): bool(v) for k, v in body.akses.items()}
    db.commit()
    db.refresh(s)
    return _out(s)


@router.post("/teknisi", response_model=schemas.SettingOut)
def add_teknisi(body: schemas.NameIn, db: Session = Depends(get_db), __: models.User = Depends(require_admin)):
    s = get_or_create(db)
    lst = list(s.teknisi or [])
    if body.nama.strip() and body.nama.strip() not in lst:
        lst.append(body.nama.strip())
    s.teknisi = lst
    db.commit()
    db.refresh(s)
    return _out(s)


@router.delete("/teknisi/{index}", response_model=schemas.SettingOut)
def del_teknisi(index: int, db: Session = Depends(get_db), __: models.User = Depends(require_admin)):
    s = get_or_create(db)
    lst = list(s.teknisi or [])
    if 0 <= index < len(lst):
        lst.pop(index)
        s.teknisi = lst
        db.commit()
        db.refresh(s)
    else:
        raise HTTPException(404, "Index tidak ada")
    return _out(s)


@router.post("/merk", response_model=schemas.SettingOut)
def add_merk(body: schemas.NameIn, db: Session = Depends(get_db), __: models.User = Depends(require_admin)):
    s = get_or_create(db)
    lst = list(s.merk or [])
    if body.nama.strip() and body.nama.strip() not in lst:
        lst.append(body.nama.strip())
    s.merk = lst
    db.commit()
    db.refresh(s)
    return _out(s)


@router.delete("/merk/{index}", response_model=schemas.SettingOut)
def del_merk(index: int, db: Session = Depends(get_db), __: models.User = Depends(require_admin)):
    s = get_or_create(db)
    lst = list(s.merk or [])
    if 0 <= index < len(lst):
        lst.pop(index)
        s.merk = lst
        db.commit()
        db.refresh(s)
    else:
        raise HTTPException(404, "Index tidak ada")
    return _out(s)
