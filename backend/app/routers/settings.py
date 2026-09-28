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
    if s.teknisi is None:
        s.teknisi = ["Andi", "Budi"]
    if s.merk is None:
        s.merk = ["Samsung", "iPhone", "Xiaomi", "Oppo", "Vivo", "Realme", "Infinix"]
    return s


@router.get("", response_model=schemas.SettingOut)
def get_settings(db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    s = get_or_create(db)
    return {"nama": s.nama, "alamat": s.alamat, "telp": s.telp, "nota": s.nota,
            "teknisi": s.teknisi or [], "merk": s.merk or []}


@router.put("", response_model=schemas.SettingOut)
def update_settings(body: schemas.SettingUpdateIn, db: Session = Depends(get_db), __: models.User = Depends(require_admin)):
    s = get_or_create(db)
    if body.nama is not None:
        s.nama = body.nama
    if body.alamat is not None:
        s.alamat = body.alamat
    if body.telp is not None:
        s.telp = body.telp
    if body.nota is not None:
        s.nota = body.nota
    db.commit()
    db.refresh(s)
    return {"nama": s.nama, "alamat": s.alamat, "telp": s.telp, "nota": s.nota,
            "teknisi": s.teknisi or [], "merk": s.merk or []}


@router.post("/teknisi", response_model=schemas.SettingOut)
def add_teknisi(body: schemas.NameIn, db: Session = Depends(get_db), __: models.User = Depends(require_admin)):
    s = get_or_create(db)
    lst = list(s.teknisi or [])
    if body.nama.strip() and body.nama.strip() not in lst:
        lst.append(body.nama.strip())
    s.teknisi = lst
    db.commit()
    db.refresh(s)
    return {"nama": s.nama, "alamat": s.alamat, "telp": s.telp, "nota": s.nota, "teknisi": s.teknisi, "merk": s.merk}


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
    return {"nama": s.nama, "alamat": s.alamat, "telp": s.telp, "nota": s.nota, "teknisi": s.teknisi, "merk": s.merk}


@router.post("/merk", response_model=schemas.SettingOut)
def add_merk(body: schemas.NameIn, db: Session = Depends(get_db), __: models.User = Depends(require_admin)):
    s = get_or_create(db)
    lst = list(s.merk or [])
    if body.nama.strip() and body.nama.strip() not in lst:
        lst.append(body.nama.strip())
    s.merk = lst
    db.commit()
    db.refresh(s)
    return {"nama": s.nama, "alamat": s.alamat, "telp": s.telp, "nota": s.nota, "teknisi": s.teknisi, "merk": s.merk}


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
    return {"nama": s.nama, "alamat": s.alamat, "telp": s.telp, "nota": s.nota, "teknisi": s.teknisi, "merk": s.merk}
