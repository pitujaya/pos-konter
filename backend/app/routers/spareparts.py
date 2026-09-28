"""CRUD /api/spareparts + lookup SKU + penyesuaian stok."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas
from ..auth import get_current_user, require_admin

router = APIRouter(prefix="/spareparts", tags=["spareparts"])


def to_out(s: models.Sparepart) -> dict:
    return {
        "id": s.id, "nama": s.nama, "sku": s.sku, "merk": s.merk or "",
        "hpp": s.hpp or 0, "harga_jual": s.harga_jual or 0,
        "stok": s.stok or 0, "stok_min": s.stok_min or 0,
    }


@router.get("", response_model=list[schemas.SparepartOut])
def list_spareparts(
    q: str = Query("", description="cari nama / sku / merk"),
    sort: str = Query("nama", description="nama|sku|stok"),
    low: bool = Query(False, description="hanya stok menipis"),
    skip: int = 0, limit: int = 1000,
    db: Session = Depends(get_db), _: models.User = Depends(get_current_user),
):
    rows = db.query(models.Sparepart).all()
    if q:
        ql = q.lower()
        rows = [r for r in rows if ql in " ".join([r.nama or "", r.sku or "", r.merk or ""]).lower()]
    if low:
        rows = [r for r in rows if (r.stok or 0) <= (r.stok_min or 0)]
    if sort == "sku":
        rows.sort(key=lambda r: (r.sku or "").lower())
    elif sort == "stok":
        rows.sort(key=lambda r: (r.stok or 0))
    else:
        rows.sort(key=lambda r: (r.nama or "").lower())
    return [to_out(r) for r in rows[skip: skip + limit]]


@router.post("", response_model=schemas.SparepartOut, status_code=201)
def create_sparepart(body: schemas.SparepartIn, db: Session = Depends(get_db), __: models.User = Depends(require_admin)):
    nama = (body.nama or "").strip()
    sku = (body.sku or "").strip()
    if not nama:
        raise HTTPException(400, "Nama barang wajib diisi")
    if not sku:
        raise HTTPException(400, "Nomor SKU wajib diisi")
    if db.query(models.Sparepart).filter(models.Sparepart.sku == sku).first():
        raise HTTPException(400, "SKU sudah dipakai")
    s = models.Sparepart(
        nama=nama, sku=sku, merk=(body.merk or "").strip(),
        hpp=int(body.hpp or 0), harga_jual=int(body.harga_jual or 0),
        stok=int(body.stok or 0), stok_min=int(body.stok_min or 0),
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return to_out(s)


@router.get("/sku/{sku}", response_model=schemas.SparepartOut)
def get_by_sku(sku: str, db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    s = db.query(models.Sparepart).filter(models.Sparepart.sku == sku.strip()).first()
    if not s:
        raise HTTPException(404, "SKU tidak ditemukan")
    return to_out(s)


@router.get("/{sp_id}", response_model=schemas.SparepartOut)
def get_sparepart(sp_id: int, db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    s = db.get(models.Sparepart, sp_id)
    if not s:
        raise HTTPException(404, "Data tidak ditemukan")
    return to_out(s)


@router.put("/{sp_id}", response_model=schemas.SparepartOut)
def update_sparepart(sp_id: int, body: schemas.SparepartUpdateIn,
                     db: Session = Depends(get_db), __: models.User = Depends(require_admin)):
    s = db.get(models.Sparepart, sp_id)
    if not s:
        raise HTTPException(404, "Data tidak ditemukan")
    data = body.model_dump(exclude_unset=True)
    if "sku" in data and data["sku"]:
        sku = data["sku"].strip()
        dup = db.query(models.Sparepart).filter(models.Sparepart.sku == sku, models.Sparepart.id != sp_id).first()
        if dup:
            raise HTTPException(400, "SKU sudah dipakai")
        data["sku"] = sku
    if "nama" in data and data["nama"] is not None:
        if not data["nama"].strip():
            raise HTTPException(400, "Nama barang wajib diisi")
        data["nama"] = data["nama"].strip()
    for k, v in data.items():
        if v is not None:
            setattr(s, k, v)
    db.commit()
    db.refresh(s)
    return to_out(s)


@router.patch("/{sp_id}/stock", response_model=schemas.SparepartOut)
def adjust_stock(sp_id: int, body: schemas.StockAdjustIn,
                 db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    s = db.get(models.Sparepart, sp_id)
    if not s:
        raise HTTPException(404, "Data tidak ditemukan")
    baru = (s.stok or 0) + int(body.delta or 0)
    if baru < 0:
        raise HTTPException(400, "Stok tidak boleh minus")
    s.stok = baru
    db.commit()
    db.refresh(s)
    return to_out(s)


@router.delete("/{sp_id}")
def delete_sparepart(sp_id: int, db: Session = Depends(get_db), __: models.User = Depends(require_admin)):
    s = db.get(models.Sparepart, sp_id)
    if not s:
        raise HTTPException(404, "Data tidak ditemukan")
    db.delete(s)
    db.commit()
    return {"ok": True}
