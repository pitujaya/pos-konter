"""Sesi buka/tutup kasir (shift): POST /api/kas/open, /api/kas/{id}/close, GET /api/kas.

Aturan:
- Satu sesi terbuka per kasir. Transaksi (service/penjualan/pengeluaran) DITOLAK
  selama tidak ada sesi terbuka (lihat require_open_session dipakai router lain).
- Rekap dihitung dari rentang waktu sesi (opened_at..closed_at):
    * penjualan  -> milik kasir ini (kolom kasir), pisahkan tunai & non-tunai
    * pengeluaran-> milik kasir ini (kolom dicatat_oleh)
    * service    -> milik kasir ini (kolom services.kasir) yang status Diambil
- kas_sistem = modal_awal + penjualan_tunai + kas_service_tunai - pengeluaran
- selisih    = kas_akhir (hitungan fisik) - kas_sistem
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas
from ..auth import get_current_user

router = APIRouter(prefix="/kas", tags=["kas"])

KASIR_ROLES = ("kasir", "admin", "superadmin")
ADMIN_ROLES = ("admin", "superadmin")


def require_open_session(db: Session, user: models.User) -> models.CashSession:
    """Dipakai router service/sales/expenses: tolak transaksi tanpa sesi kasir."""
    s = _find_open(db, user)
    if not s:
        raise HTTPException(
            409,
            "Belum ada sesi kasir terbuka. Buka sesi kasir dulu sebelum input transaksi.",
        )
    return s


def _find_open(db: Session, user: models.User) -> models.CashSession | None:
    if user is None:
        return None
    q = db.query(models.CashSession).filter(models.CashSession.status == "open")
    if user.id:
        by_id = q.filter(models.CashSession.user_id == user.id) \
                 .order_by(models.CashSession.id.desc()).first()
        if by_id:
            return by_id
    # Fallback untuk sesi legacy (user_id NULL): cocokkan by nama, TAPI hanya
    # kalau tidak ambigu. Kalau ada 2 sesi terbuka dengan nama sama, jangan
    # menebak -> kembalikan None supaya user buka sesi sendiri (bukan session
    # milik orang lain).
    nama = (user.nama or "").strip()
    if not nama:
        return None
    by_name = q.filter(models.CashSession.kasir == nama).order_by(
        models.CashSession.id.desc()).all()
    if len(by_name) == 1:
        return by_name[0]
    return None


def _is_tunai(metode: str) -> bool:
    m = (metode or "").strip().lower()
    return m in ("", "tunai", "cash", "tunai/lunas")


def _session_open_at(db: Session, ts: datetime) -> models.CashSession | None:
    """Sesi yang sedang aktif pada waktu ts (untuk service legacy tanpa kasir)."""
    q = db.query(models.CashSession).filter(
        models.CashSession.opened_at <= ts,
        (models.CashSession.closed_at.is_(None)) | (models.CashSession.closed_at >= ts),
    ).order_by(models.CashSession.opened_at.desc())
    return q.first()


def _services_for_session(db: Session, sess: models.CashSession) -> list[models.Service]:
    """Service yang diambil (Diambil) di dalam rentang waktu sesi INI.

    PENTING: sebelumnya query ini tidak memfilter kasir sama sekali, jadi
    service yang dikerjakan kasir lain ikut terhitung ke sesi ini -> omzet
    salah orang. Sekarang:
      - service yang punya kolom kasir -> hanya cocok bila kasir sama.
      - service legacy (kasir kosong) -> dipakai oleh sesi yang aktif pada
        saat statusnya diubah ke Diambil (fallback terbaik).
    """
    t0 = sess.opened_at or datetime.utcnow()
    t1 = sess.closed_at or datetime.utcnow()
    kasir = (sess.kasir or "").strip()
    hist = (db.query(models.ServiceHistory)
            .filter(models.ServiceHistory.status == "Diambil",
                    models.ServiceHistory.created_at >= t0,
                    models.ServiceHistory.created_at <= t1)
            .order_by(models.ServiceHistory.created_at.asc())
            .all())
    out: list[models.Service] = []
    seen: set[int] = set()
    for h in hist:
        if h.service_id in seen:
            continue
        s = db.get(models.Service, h.service_id)
        if s is None:
            continue
        svc_kasir = (s.kasir or "").strip()
        if svc_kasir:
            if kasir and svc_kasir != kasir:
                continue  # milik kasir lain -> bukan bagian sesi ini
        else:
            owner = _session_open_at(db, h.created_at)
            if owner is not None and owner.id != sess.id:
                continue  # legacy: sesi lain yang aktif saat itu
        seen.add(h.service_id)
        out.append(s)
    return out


def _summary(db: Session, sess: models.CashSession) -> dict:
    """Rekap transaksi dalam rentang waktu sesi (dipakai sesi terbuka & saat tutup)."""
    t0 = sess.opened_at or datetime.utcnow()
    t1 = sess.closed_at or datetime.utcnow()
    kasir = (sess.kasir or "").strip()

    sales = (db.query(models.Sale)
             .filter(models.Sale.created_at >= t0, models.Sale.created_at <= t1)
             .all())
    if kasir:
        sales = [s for s in sales if (s.kasir or "").strip() == kasir]

    expenses = (db.query(models.Expense)
                .filter(models.Expense.created_at >= t0, models.Expense.created_at <= t1)
                .all())
    if kasir:
        expenses = [e for e in expenses if (e.dicatat_oleh or "").strip() == kasir]

    svcs = _services_for_session(db, sess)

    penjualan_total = sum(int(s.total or 0) for s in sales)
    tunai = sum(int(s.total or 0) for s in sales if _is_tunai(s.metode))
    biaya = [e for e in expenses
             if str(getattr(e, "jenis", "biaya") or "biaya").strip().lower() != "pendapatan"]
    pendapatan_lain = sum(int(e.jumlah or 0) for e in expenses
                          if str(getattr(e, "jenis", "biaya") or "biaya").strip().lower() == "pendapatan")
    pengeluaran = sum(int(e.jumlah or 0) for e in biaya)
    service_omzet = sum(int(s.biaya or 0) for s in svcs)
    # Service dibayar tunai -> uang masuk laci kas, harus ikut kas_sistem.
    # Kalau tidak, setiap shift yang ada pembayaran service cash selalu
    # nampil "selisih" palsu sebesar total service.
    service_tunai = sum(int(s.biaya or 0) for s in svcs
                        if _is_tunai(getattr(s, "metode_bayar", "tunai")))
    kas_sistem = int(sess.modal_awal or 0) + tunai + service_tunai + pendapatan_lain - pengeluaran

    return {
        "jml_transaksi": len(sales) + len(svcs) + len(expenses),
        "penjualan_count": len(sales),
        "penjualan_total": penjualan_total,
        "tunai_masuk": tunai,
        "non_tunai": penjualan_total - tunai,
        "pengeluaran_total": pengeluaran,
        "service_count": len(svcs),
        "service_omzet": service_omzet,
        "service_tunai": service_tunai,
        "kas_sistem": kas_sistem,
    }


def _to_out(sess: models.CashSession, db: Session | None = None) -> dict:
    live = _summary(db, sess) if (db is not None and sess.status == "open") else None
    if live:
        kas_sistem = live["kas_sistem"]
    else:
        kas_sistem = int(sess.kas_sistem or 0)
    kas_akhir = int(sess.kas_akhir or 0)
    selisih = kas_akhir - kas_sistem if sess.status == "closed" else 0
    return {
        "id": sess.id, "user_id": sess.user_id, "kasir": sess.kasir or "",
        "status": sess.status or "open",
        "modal_awal": int(sess.modal_awal or 0),
        "opened_at": sess.opened_at.isoformat() if sess.opened_at else None,
        "closed_at": sess.closed_at.isoformat() if sess.closed_at else None,
        "jml_transaksi": int((live or {}).get("jml_transaksi", sess.jml_transaksi or 0)),
        "penjualan_count": int((live or {}).get("penjualan_count", sess.penjualan_count or 0)),
        "penjualan_total": int((live or {}).get("penjualan_total", sess.penjualan_total or 0)),
        "tunai_masuk": int((live or {}).get("tunai_masuk", sess.tunai_masuk or 0)),
        "non_tunai": int((live or {}).get("non_tunai", sess.non_tunai or 0)),
        "pengeluaran_total": int((live or {}).get("pengeluaran_total", sess.pengeluaran_total or 0)),
        "service_count": int((live or {}).get("service_count", sess.service_count or 0)),
        "service_omzet": int((live or {}).get("service_omzet", sess.service_omzet or 0)),
        "service_tunai": int((live or {}).get("service_tunai", sess.service_tunai or 0)),
        "kas_sistem": kas_sistem,
        "kas_akhir": kas_akhir,
        "selisih": selisih,
        "catatan": sess.catatan or "",
    }


@router.post("/open", response_model=schemas.CashSessionOut, status_code=201)
def open_session(body: schemas.CashSessionOpenIn, db: Session = Depends(get_db),
                 user: models.User = Depends(get_current_user)):
    if user.role not in KASIR_ROLES:
        raise HTTPException(403, "Role tidak berhak buka sesi kasir")
    existing = _find_open(db, user)
    if existing:
        raise HTTPException(
            400,
            f"Sesi kasir masih terbuka sejak {existing.opened_at:%d-%m-%Y %H:%M}. "
            "Tutup sesi lama dulu sebelum buka sesi baru.",
        )
    sess = models.CashSession(
        user_id=user.id, kasir=user.nama or "", status="open",
        modal_awal=int(body.modal_awal or 0),
        catatan=(body.catatan or "").strip(),
        opened_at=datetime.utcnow(),
    )
    db.add(sess)
    db.commit()
    db.refresh(sess)
    return _to_out(sess, db)


@router.post("/{session_id}/close", response_model=schemas.CashSessionOut)
def close_session(session_id: int, body: schemas.CashSessionCloseIn,
                  db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    sess = db.get(models.CashSession, session_id)
    if not sess:
        raise HTTPException(404, "Sesi kasir tidak ditemukan")
    if sess.status == "closed":
        raise HTTPException(400, "Sesi kasir sudah ditutup")
    if sess.user_id != user.id and user.role not in ("admin", "superadmin"):
        raise HTTPException(403, "Hanya kasir pemilik sesi (atau admin) yang boleh menutup sesi")

    live = _summary(db, sess)
    now = datetime.utcnow()
    sess.status = "closed"
    sess.closed_at = now
    for k, v in live.items():
        setattr(sess, k, v)
    sess.kas_akhir = int(body.kas_akhir or 0)
    sess.kas_sistem = int(live["kas_sistem"] or 0)
    sess.selisih = sess.kas_akhir - sess.kas_sistem
    note = (body.catatan or "").strip()
    if note:
        sess.catatan = (sess.catatan or "").strip()
        sess.catatan = (sess.catatan + " | " + note) if sess.catatan else note
    db.commit()
    db.refresh(sess)
    return _to_out(sess, db)


@router.get("/current", response_model=schemas.CashSessionOut | None)
def current_session(db: Session = Depends(get_db),
                    user: models.User = Depends(get_current_user)):
    """Sesi terbuka milik user ini (null bila belum buka sesi). Rekap dihitung live."""
    s = _find_open(db, user)
    return _to_out(s, db) if s else None


@router.get("", response_model=list[schemas.CashSessionOut])
def list_sessions(
    scope: str = Query("auto", description="mine|all|auto (auto: admin+ lihat semua)"),
    limit: int = 50,
    db: Session = Depends(get_db), user: models.User = Depends(get_current_user),
):
    scope = (scope or "auto").strip().lower()
    if scope not in ("mine", "all", "auto"):
        raise HTTPException(400, "scope tidak valid (mine|all|auto)")
    # scope="all" HANYA untuk admin/superadmin. Sebelumnya parameter ini
    # melewati pengecekan role sama sekali -> kasir biasa bisa membaca sesi
    # kasir lain (modal awal, kas akhir, selisih) lewat scope=all.
    if scope == "all" and user.role not in ADMIN_ROLES:
        raise HTTPException(403, "Hanya admin/superadmin yang bisa melihat semua sesi kasir")
    q = db.query(models.CashSession)
    want_all = user.role in ADMIN_ROLES and scope in ("all", "auto")
    if not want_all:
        if user.id:
            q = q.filter(models.CashSession.user_id == user.id)
        else:
            q = q.filter(models.CashSession.kasir == (user.nama or ""))
    rows = q.order_by(models.CashSession.id.desc()).limit(max(1, min(limit, 200))).all()
    return [_to_out(r, db) for r in rows]
