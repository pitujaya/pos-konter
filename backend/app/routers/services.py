"""CRUD /api/services + /api/stats/dashboard."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas
from ..auth import get_current_user, require_admin

router = APIRouter(tags=["services"])
STATUS = ["Antri", "Dikerjakan", "Menunggu Sparepart", "Selesai", "Diambil", "Batal"]


def to_out(s: models.Service) -> dict:
    h = sorted(s.histories, key=lambda x: x.id or 0)
    return {
        "id": s.id, "noService": s.no_service, "tanggal": s.tanggal or "",
        "nama": s.nama, "telp": s.telp, "alamat": s.alamat or "",
        "merk": s.merk, "tipe": s.tipe, "warna": s.warna or "", "imei": s.imei or "",
        "sandi": s.sandi or "", "kelengkapan": s.kelengkapan or [],
        "keluhan": s.keluhan, "kondisi": s.kondisi or "", "teknisi": s.teknisi or "",
        "biaya": s.biaya or 0, "dp": s.dp or 0, "estimasi": s.estimasi or "",
        "catatan": s.catatan or "", "status": s.status,
        "riwayat": [{"t": (x.created_at.isoformat() if x.created_at else ""), "s": x.status} for x in h],
    }


def gen_no_service(db: Session) -> str:
    y = datetime.now().year
    n = db.query(models.Service).filter(models.Service.no_service.like(f"%{y}%")).count() + 1
    # hindari tabrakan nomor
    while db.query(models.Service).filter(models.Service.no_service == f"SVC-{y}-{n:04d}").first():
        n += 1
    return f"SVC-{y}-{n:04d}"


@router.get("/services", response_model=list[schemas.ServiceOut])
def list_services(
    q: str = Query("", description="cari no service / nama / telp / merk / tipe / keluhan"),
    status: str = Query("Semua"),
    sort: str = Query("baru", description="baru|lama|nama"),
    skip: int = 0, limit: int = 500,
    db: Session = Depends(get_db), _: models.User = Depends(get_current_user),
):
    rows = db.query(models.Service).all()
    if status and status != "Semua":
        rows = [r for r in rows if (r.status or "Antri") == status]
    if q:
        ql = q.lower()
        rows = [r for r in rows if ql in " ".join([
            r.no_service or "", r.nama or "", r.telp or "", r.merk or "", r.tipe or "", r.keluhan or "",
        ]).lower()]
    if sort == "lama":
        rows.sort(key=lambda r: r.id or 0)
    elif sort == "nama":
        rows.sort(key=lambda r: (r.nama or "").lower())
    else:
        rows.sort(key=lambda r: r.id or 0, reverse=True)
    return [to_out(r) for r in rows[skip: skip + limit]]


@router.post("/services", response_model=schemas.ServiceOut, status_code=201)
def create_service(body: schemas.ServiceIn, db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    for f in ("nama", "telp", "merk", "tipe", "keluhan"):
        if not (getattr(body, f) or "").strip():
            raise HTTPException(400, f"{f} wajib diisi")
    if body.status not in STATUS:
        raise HTTPException(400, "Status tidak valid")
    s = models.Service(
        no_service=gen_no_service(db),
        tanggal=body.tanggal or datetime.now().date().isoformat(),
        nama=body.nama.strip(), telp=body.telp.strip(), alamat=(body.alamat or "").strip(),
        merk=body.merk.strip(), tipe=body.tipe.strip(),
        warna=(body.warna or ""), imei=(body.imei or ""), sandi=(body.sandi or ""),
        kelengkapan=body.kelengkapan or [], keluhan=body.keluhan.strip(),
        kondisi=(body.kondisi or ""), teknisi=(body.teknisi or ""),
        biaya=int(body.biaya or 0), dp=int(body.dp or 0),
        estimasi=(body.estimasi or ""), catatan=(body.catatan or ""), status=body.status,
    )
    db.add(s)
    db.flush()
    db.add(models.ServiceHistory(service_id=s.id, status=s.status))
    db.commit()
    db.refresh(s)
    return to_out(s)


@router.get("/services/next-number")
def next_number(db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    return {"no_service": gen_no_service(db)}


@router.get("/services/{service_id}", response_model=schemas.ServiceOut)
def get_service(service_id: int, db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    s = db.get(models.Service, service_id)
    if not s:
        raise HTTPException(404, "Data tidak ditemukan")
    return to_out(s)


@router.put("/services/{service_id}", response_model=schemas.ServiceOut)
def update_service(service_id: int, body: schemas.ServiceUpdateIn,
                   db: Session = Depends(get_db), __: models.User = Depends(require_admin)):
    s = db.get(models.Service, service_id)
    if not s:
        raise HTTPException(404, "Data tidak ditemukan")
    data = body.model_dump(exclude_unset=True)
    new_status = data.pop("status", None)
    for k, v in data.items():
        if v is not None:
            setattr(s, k, v)
    if new_status and new_status != s.status:
        if new_status not in STATUS:
            raise HTTPException(400, "Status tidak valid")
        s.status = new_status
        db.add(models.ServiceHistory(service_id=s.id, status=new_status))
    db.commit()
    db.refresh(s)
    return to_out(s)


@router.patch("/services/{service_id}/status", response_model=schemas.ServiceOut)
def set_status(service_id: int, body: schemas.StatusUpdateIn,
               db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    if body.status not in STATUS:
        raise HTTPException(400, "Status tidak valid")
    s = db.get(models.Service, service_id)
    if not s:
        raise HTTPException(404, "Data tidak ditemukan")
    s.status = body.status
    db.add(models.ServiceHistory(service_id=s.id, status=body.status))
    db.commit()
    db.refresh(s)
    return to_out(s)


@router.delete("/services/{service_id}")
def delete_service(service_id: int, db: Session = Depends(get_db), __: models.User = Depends(require_admin)):
    s = db.get(models.Service, service_id)
    if not s:
        raise HTTPException(404, "Data tidak ditemukan")
    db.delete(s)
    db.commit()
    return {"ok": True}


@router.get("/stats/dashboard")
def dashboard(db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    rows = db.query(models.Service).all()
    c = lambda st: sum(1 for r in rows if r.status == st)
    omzet = sum(int(r.biaya or 0) for r in rows if r.status != "Batal")
    return {
        "total": len(rows), "antri": c("Antri"),
        "proses": c("Dikerjakan") + c("Menunggu Sparepart"),
        "selesai": c("Selesai") + c("Diambil"),
        "omzet": omzet,
        "per_status": {st: c(st) for st in STATUS},
    }
