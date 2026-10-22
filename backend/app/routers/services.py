"""CRUD /api/services + /api/stats/dashboard."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas
from ..auth import get_current_user, require_admin

router = APIRouter(tags=["services"])
STATUS = ["Dikerjakan", "Selesai", "Diambil", "Cancel"]
# Migrasi status lama -> baru (Antri/Menunggu Sparepart -> Dikerjakan, Batal -> Cancel)
STATUS_NORM = {"Antri": "Dikerjakan", "Menunggu Sparepart": "Dikerjakan", "Batal": "Cancel"}


def _map_status(s: str | None) -> str:
    """Petakan status legacy ke status baru, TANPA fallback diam-diam."""
    raw = (s or "").strip()
    return STATUS_NORM.get(raw, raw)


def norm_status(s: str | None) -> str:
    """Untuk MEMBACA data lama: status tak dikenal dianggap 'Dikerjakan'."""
    m = _map_status(s)
    return m if m in STATUS else "Dikerjakan"


def validate_status(s: str | None) -> str:
    """Untuk MENYIMPAN: status tak dikenal harus DITOLAK (400), bukan ditulis
    diam-diam jadi 'Dikerjakan' (pernah membuat riwayat status palsu)."""
    m = _map_status(s)
    if m not in STATUS:
        raise HTTPException(400, "Status tidak valid. Pilihan: " + ", ".join(STATUS))
    return m


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
        "kasir": getattr(s, "kasir", "") or "",
        "metode_bayar": getattr(s, "metode_bayar", "tunai") or "tunai",
        "wa_terkirim_at": (s.wa_terkirim_at.isoformat() if getattr(s, "wa_terkirim_at", None) else ""),
        "wa_terkirim_oleh": getattr(s, "wa_terkirim_oleh", "") or "",
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
        status = norm_status(status)
        rows = [r for r in rows if norm_status(r.status) == status]
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
def create_service(body: schemas.ServiceIn, db: Session = Depends(get_db),
                   user: models.User = Depends(get_current_user)):
    from .kas_sessions import require_open_session
    require_open_session(db, user)
    for f in ("nama", "telp", "merk", "tipe", "keluhan"):
        if not (getattr(body, f) or "").strip():
            raise HTTPException(400, f"{f} wajib diisi")
    body.status = validate_status(body.status)
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
        # Kasir SELALU dari user yang login (jangan dari body) -> tidak bisa
        #oustonREDIT service ke nama kasir lain & menggeser rekap per kasir.
        kasir=(user.nama or "").strip(),
        metode_bayar=(body.metode_bayar or "tunai").strip().lower() or "tunai",
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
                   db: Session = Depends(get_db), user: models.User = Depends(require_admin)):
    s = db.get(models.Service, service_id)
    if not s:
        raise HTTPException(404, "Data tidak ditemukan")
    data = body.model_dump(exclude_unset=True)
    new_status = data.pop("status", None)
    # Kasir tidak boleh diubah lewat edit (menyesuaikan rekap per kasir).
    data.pop("kasir", None)
    if new_status and validate_status(new_status) == "Diambil":
        # Status -> Diambil = membukukan omzet -> butuh sesi kasir terbuka.
        from .kas_sessions import require_open_session
        require_open_session(db, user)
    for k, v in data.items():
        if v is not None:
            setattr(s, k, v)
    if new_status and validate_status(new_status) != norm_status(s.status):
        new_status = validate_status(new_status)
        s.status = new_status
        db.add(models.ServiceHistory(service_id=s.id, status=new_status))
    db.commit()
    db.refresh(s)
    return to_out(s)


@router.patch("/services/{service_id}/status", response_model=schemas.ServiceOut)
def set_status(service_id: int, body: schemas.StatusUpdateIn,
               db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    new_status = validate_status(body.status)
    s = db.get(models.Service, service_id)
    if not s:
        raise HTTPException(404, "Data tidak ditemukan")
    # Mengubah status ke "Diambil" = membukukan omzet ke sesi kasir.
    # Kalau tidak ada sesi terbuka, omzetnya masuk ke sesi berikutnya / hilang
    # -> harus minta buka sesi dulu, sama seperti input transaksi lain.
    if new_status == "Diambil":
        from .kas_sessions import require_open_session
        require_open_session(db, user)
    s.status = new_status
    db.add(models.ServiceHistory(service_id=s.id, status=new_status))
    db.commit()
    db.refresh(s)
    return to_out(s)


@router.post("/services/purge")
def purge_services(body: dict, db: Session = Depends(get_db),
                   user: models.User = Depends(get_current_user)):
    """Hapus massal service.

    scope = "diambil" -> hapus semua yang statusnya Diambil (admin+)
    scope = "all"     -> hapus semua service (superadmin)

    Endpoint ini WAJIB ada karena tombol "Hapus SEMUA data" di frontend
    sebelumnya hanya mengubah LocalStorage: data di server tetap utuh dan
    muncul lagi begitu halaman di-refresh, padahal user sudah diberi toast
    "Semua data dihapus".
    """
    scope = str((body or {}).get("scope") or "").strip().lower()
    if scope == "all":
        if user.role != "superadmin":
            raise HTTPException(403, "Hanya Super Admin yang bisa menghapus semua data")
    elif scope == "diambil":
        if user.role not in ("admin", "superadmin"):
            raise HTTPException(403, "Hanya Admin/Super Admin yang bisa menghapus data selesai")
    else:
        raise HTTPException(400, "scope tidak valid (diambil|all)")

    q = db.query(models.Service)
    if scope == "diambil":
        q = q.filter(models.Service.status == "Diambil")
    rows = q.all()
    n = len(rows)
    for s in rows:
        db.delete(s)
    db.commit()
    return {"ok": True, "deleted": n, "scope": scope}


@router.post("/services/{service_id}/wa-notifikasi", response_model=schemas.ServiceOut)
def mark_wa_sent(service_id: int, db: Session = Depends(get_db),
                 user: models.User = Depends(get_current_user)):
    """Tandai notifikasi WhatsApp sudah dikirim ke pelanggan.

    Dipakai frontend setelah kasir menekan tombol "Kirim WhatsApp", supaya
    ada rekap berapa notifikasi yang sudah keluar (bisa dilihat di tab
    Rekap Harian).
    """
    s = db.get(models.Service, service_id)
    if not s:
        raise HTTPException(404, "Data tidak ditemukan")
    s.wa_terkirim_at = datetime.utcnow()
    s.wa_terkirim_oleh = (user.nama or "").strip()
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
    c = lambda st: sum(1 for r in rows if norm_status(r.status) == st)
    # Omzet hanya dari service yang SUDAH DIAMBIL
    omzet = sum(int(r.biaya or 0) for r in rows if norm_status(r.status) == "Diambil")
    return {
        "total": len(rows), "antri": c("Dikerjakan"),
        "proses": c("Selesai"),
        "selesai": c("Diambil"),
        "omzet": omzet,
        "per_status": {st: c(st) for st in STATUS},
    }
