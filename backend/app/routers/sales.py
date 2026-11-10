"""CRUD /api/sales (penjualan barang) + /api/stats/report (laporan)."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas
from ..auth import get_current_user, require_admin, require_kasir_laba

router = APIRouter(tags=["sales"])
STATUS_SERVICE = ["Dikerjakan", "Selesai", "Diambil", "Cancel"]
STATUS_NORM = {"Antri": "Dikerjakan", "Menunggu Sparepart": "Dikerjakan", "Batal": "Cancel"}


def _norm_status(s: str | None) -> str:
    s = (s or "").strip()
    s = STATUS_NORM.get(s, s)
    return s if s in STATUS_SERVICE else "Dikerjakan"


def _is_income(e) -> bool:
    return str(getattr(e, "jenis", "biaya") or "biaya").strip().lower() == "pendapatan"


def _expense_sumber(e) -> str:
    """Sumber atribusi: service | penjualan | '' (data lama/belum dialokasikan)."""
    s = str(getattr(e, "sumber", "") or "").strip().lower()
    if s in ("service", "omset service", "omzet service", "jasa"):
        return "service"
    if s in ("penjualan", "jual", "sales"):
        return "penjualan"
    return ""


def _sale_diskon(s: models.Sale) -> int:
    return int(getattr(s, "diskon", 0) or 0)


def _sale_subtotal(s: models.Sale) -> int:
    """Subtotal sebelum diskon. Nota lama (sebelum ada diskon) -> subtotal = total."""
    sub = int(getattr(s, "subtotal", 0) or 0)
    if sub:
        return sub
    return int(s.total or 0) + _sale_diskon(s)


def _sale_to_out(s: models.Sale) -> dict:
    items = sorted(s.items or [], key=lambda x: x.id or 0)
    return {
        "id": s.id, "no_nota": s.no_nota, "tanggal": s.tanggal or "",
        "pelanggan": s.pelanggan or "", "telp": s.telp or "",
        "subtotal": _sale_subtotal(s), "diskon": _sale_diskon(s),
        "diskon_persen": int(getattr(s, "diskon_persen", 0) or 0),
        "total": s.total or 0, "hpp_total": s.hpp_total or 0, "laba": s.laba or 0,
        "metode": s.metode or "Tunai", "catatan": s.catatan or "",
        "kasir": s.kasir or "",
        "created_at": (s.created_at.isoformat() if getattr(s, "created_at", None) else ""),
        "items": [
            {"sparepart_id": i.sparepart_id, "sku": i.sku or "", "nama": i.nama or "",
             "hpp": i.hpp or 0, "harga": i.harga or 0, "qty": i.qty or 0,
             "subtotal": i.subtotal or 0}
            for i in items
        ],
    }


def _gen_no_nota(db: Session) -> str:
    y = datetime.now().year
    n = db.query(models.Sale).filter(models.Sale.no_nota.like(f"%{y}%")).count() + 1
    while db.query(models.Sale).filter(models.Sale.no_nota == f"SL-{y}-{n:04d}").first():
        n += 1
    return f"SL-{y}-{n:04d}"


def _in_range(tgl: str, dari: str, sampai: str) -> bool:
    t = (tgl or "")[:10]
    if dari and t < dari[:10]:
        return False
    if sampai and t > sampai[:10]:
        return False
    return True


def _match_kasir(nama: str | None, kasir: str) -> bool:
    """Cocokkan nama kasir (tanpa sensitivitas huruf & spasi ganda)."""
    kasir = (kasir or "").strip()
    if not kasir:
        return True
    n = " ".join((nama or "").split()).casefold()
    return n == " ".join(kasir.split()).casefold()


def _is_tunai_metode(metode: str | None) -> bool:
    m = (metode or "").strip().lower()
    return m in ("", "tunai", "cash", "tunai/lunas")


ADMIN_ROLES = ("admin", "superadmin")


def _session_or_404(db: Session, sesi_id: int, user: models.User) -> models.CashSession:
    """Ambil sesi kasir + pastikan user berhak melihatnya."""
    sess = db.get(models.CashSession, int(sesi_id or 0))
    if sess is None:
        raise HTTPException(404, "Sesi kasir tidak ditemukan")
    if user.role not in ADMIN_ROLES:
        same_user = sess.user_id is not None and sess.user_id == user.id
        same_name = bool((sess.kasir or "").strip()) and _match_kasir(sess.kasir, user.nama or "")
        if not (same_user or same_name):
            raise HTTPException(403, "Tidak berhak melihat sesi kasir lain")
    return sess


def _session_window(sess: models.CashSession) -> tuple[datetime, datetime]:
    t0 = sess.opened_at or datetime.utcnow()
    t1 = sess.closed_at or datetime.utcnow()
    return t0, t1


def _in_window(ts: datetime | None, t0: datetime, t1: datetime) -> bool:
    return ts is not None and t0 <= ts <= t1


def _collect_session(db: Session, sess: models.CashSession):
    """Transaksi selama satu sesi kasir (lintas tanggal).

    - Service "masuk" = service yang dibuat di dalam rentang sesi.
    - Service "diambil"/omzet = service yang status Diambil di dalam rentang sesi
      (sama seperti rekap sesi kasir, termasuk fallback data legacy).
    - Penjualan & biaya difilter dari created_at, bukan tanggal nota.
    - Digital tidak punya kolom kasir -> tidak diikutkan pada laporan per sesi.
    """
    from .kas_sessions import _services_for_session

    t0, t1 = _session_window(sess)
    kasir = (sess.kasir or "").strip()

    services_created = [
        r for r in db.query(models.Service).all()
        if _in_window(getattr(r, "created_at", None), t0, t1)
        and (not kasir or _match_kasir(getattr(r, "kasir", ""), kasir))
    ]
    sales = [
        r for r in db.query(models.Sale).all()
        if _in_window(getattr(r, "created_at", None), t0, t1)
        and (not kasir or _match_kasir(getattr(r, "kasir", ""), kasir))
    ]
    try:
        expenses = [
            r for r in db.query(models.Expense).all()
            if _in_window(getattr(r, "created_at", None), t0, t1)
            and (not kasir or _match_kasir(getattr(r, "dicatat_oleh", ""), kasir))
        ]
    except Exception:
        expenses = []
    services_diambil = _services_for_session(db, sess)
    return services_created, services_diambil, sales, expenses


def _collect_until(db: Session, t1: datetime, kasir: str):
    """Transaksi kumulatif sampai akhir sesi (untuk snapshot posisi keuangan)."""
    kasir = (kasir or "").strip()
    services = [
        r for r in db.query(models.Service).all()
        if getattr(r, "created_at", None) is not None
        and getattr(r, "created_at") <= t1
        and (not kasir or _match_kasir(getattr(r, "kasir", ""), kasir))
    ]
    sales = [
        r for r in db.query(models.Sale).all()
        if getattr(r, "created_at", None) is not None
        and getattr(r, "created_at") <= t1
        and (not kasir or _match_kasir(getattr(r, "kasir", ""), kasir))
    ]
    try:
        expenses = [
            r for r in db.query(models.Expense).all()
            if getattr(r, "created_at", None) is not None
            and getattr(r, "created_at") <= t1
            and (not kasir or _match_kasir(getattr(r, "dicatat_oleh", ""), kasir))
        ]
    except Exception:
        expenses = []
    return services, sales, expenses


def _collect_periode(db: Session, dari: str, sampai: str, kasir: str):
    """Ambil transaksi yang sudah difilter periode & kasir (dipakai semua laporan)."""
    services = db.query(models.Service).all()
    sales = db.query(models.Sale).all()
    try:
        expenses = db.query(models.Expense).all()
    except Exception:
        expenses = []
    try:
        digital = db.query(models.DigitalSale).all()
    except Exception:
        digital = []
    if dari or sampai:
        services = [r for r in services if _in_range(r.tanggal or "", dari, sampai)]
        sales = [r for r in sales if _in_range(r.tanggal or "", dari, sampai)]
        expenses = [r for r in expenses if _in_range(getattr(r, "tanggal", "") or "", dari, sampai)]
        digital = [r for r in digital if _in_range(getattr(r, "tanggal", "") or "", dari, sampai)]
    kasir = (kasir or "").strip()
    if kasir:
        services = [r for r in services if _match_kasir(getattr(r, "kasir", ""), kasir)]
        sales = [r for r in sales if _match_kasir(r.kasir, kasir)]
        expenses = [r for r in expenses if _match_kasir(getattr(r, "dicatat_oleh", ""), kasir)]
        # Penjualan digital tidak punya kolom kasir.
        digital = []
    return services, sales, expenses, digital


def _group_uang(rows: list) -> list[dict]:
    """Kelompokkan expense/pendapatan per kategori (jumlah & transaksi)."""
    data: dict[str, dict] = {}
    for r in rows:
        kat = (getattr(r, "kategori", "") or "Lainnya").strip() or "Lainnya"
        row = data.setdefault(kat, {"kategori": kat, "jumlah": 0, "count": 0})
        row["jumlah"] += int(getattr(r, "jumlah", 0) or 0)
        row["count"] += 1
    return sorted(data.values(), key=lambda x: (-x["jumlah"], x["kategori"].lower()))


def _sessions_periode(db: Session, dari: str, sampai: str, kasir: str) -> list:
    rows = db.query(models.CashSession).all()
    if dari or sampai:
        rows = [r for r in rows if _in_range(
            (r.opened_at.date().isoformat() if r.opened_at else ""), dari, sampai)]
    kasir = (kasir or "").strip()
    if kasir:
        rows = [r for r in rows if _match_kasir(r.kasir, kasir)]
    rows.sort(key=lambda r: (r.opened_at or datetime.min))
    return rows


def _opening_cash(sessions: list) -> int:
    """Modal awal per kasir (sesi paling awal), bukan dijumlah semua shift."""
    first: dict[str, object] = {}
    for s in sessions:
        key = " ".join((s.kasir or "").split()).casefold() or "-"
        t = s.opened_at or datetime.min
        if key not in first or t < first[key][0]:
            first[key] = (t, int(s.modal_awal or 0))
    return sum(v[1] for v in first.values())


@router.post("/sales", response_model=schemas.SaleOut, status_code=201)
def create_sale(body: schemas.SaleIn, db: Session = Depends(get_db),
                user: models.User = Depends(get_current_user)):
    from .kas_sessions import require_open_session
    require_open_session(db, user)
    if not body.items:
        raise HTTPException(400, "Keranjang masih kosong, pilih minimal 1 barang")
    tanggal = (body.tanggal or datetime.now().date().isoformat())[:10]
    # Baris keranjang (pertahankan 1 baris = 1 item di nota).
    lines: list[tuple[models.Sparepart, int]] = []
    # Agregasi per SKU: barang yang sama bisa masuk 2 baris keranjang.
    # Kalau stok dicek per baris, tiap baris lolos cek lalu dikurangi sendiri ->
    # stok akhir jadi NEGATIF. Jadi cek & kurangi pakai total qty per SKU.
    per_item: dict[int, int] = {}
    sp_cache: dict[int, models.Sparepart] = {}
    for it in body.items:
        qty = int(it.qty or 0)
        if qty <= 0:
            raise HTTPException(400, "Qty harus minimal 1")
        sp = None
        if it.sparepart_id:
            sp = sp_cache.get(int(it.sparepart_id))
            if sp is None:
                sp = db.get(models.Sparepart, int(it.sparepart_id))
                if sp is not None:
                    sp_cache[sp.id] = sp
        if not sp and it.sku:
            sp = db.query(models.Sparepart).filter(models.Sparepart.sku == it.sku.strip()).first()
            if sp is not None:
                sp_cache[sp.id] = sp
        if not sp:
            raise HTTPException(404, f"Barang tidak ditemukan (id={it.sparepart_id} sku={it.sku})")
        per_item[sp.id] = per_item.get(sp.id, 0) + qty
        lines.append((sp, qty))
    # Validasi stok terhadap TOTAL qty per SKU
    for sp_id, total_qty in per_item.items():
        sp = sp_cache[sp_id]
        if (sp.stok or 0) < total_qty:
            raise HTTPException(
                400,
                f"Stok {sp.nama} kurang (sisa {sp.stok}, diminta {total_qty})",
            )
    subtotal = sum((sp.harga_jual or 0) * qty for sp, qty in lines)
    hpp_total = sum((sp.hpp or 0) * qty for sp, qty in lines)
    # Diskon: persen dihitung server dari subtotal (agar tidak bisa dimanipulasi),
    # nominal dipakai apa adanya. Nilai selalu dibatasi 0..subtotal.
    diskon_persen = int(body.diskon_persen or 0)
    if diskon_persen > 0:
        diskon = int(round(subtotal * diskon_persen / 100))
    else:
        diskon = int(body.diskon or 0)
    diskon = max(0, min(diskon, subtotal))
    total = subtotal - diskon
    sale = models.Sale(
        no_nota=_gen_no_nota(db), tanggal=tanggal,
        pelanggan=(body.pelanggan or "").strip() or "Umum",
        telp=(body.telp or "").strip(),
        subtotal=subtotal, diskon=diskon, diskon_persen=diskon_persen,
        total=total, hpp_total=hpp_total, laba=total - hpp_total,
        metode=(body.metode or "Tunai").strip() or "Tunai",
        catatan=(body.catatan or "").strip(),
        kasir=user.nama or "",
    )
    db.add(sale)
    db.flush()
    # Kurangi stok per SKU (agregat), lalu tulis 1 baris item per baris keranjang.
    for sp_id, total_qty in per_item.items():
        sp = sp_cache[sp_id]
        sp.stok = (sp.stok or 0) - total_qty
    for sp, qty in lines:
        db.add(models.SaleItem(
            sale_id=sale.id, sparepart_id=sp.id, sku=sp.sku or "", nama=sp.nama or "",
            hpp=sp.hpp or 0, harga=sp.harga_jual or 0, qty=qty,
            subtotal=(sp.harga_jual or 0) * qty,
        ))
    db.commit()
    db.refresh(sale)
    return _sale_to_out(sale)


@router.get("/sales", response_model=list[schemas.SaleOut])
def list_sales(
    q: str = Query("", description="cari no nota / pelanggan / telp"),
    dari: str = Query("", description="YYYY-MM-DD"),
    sampai: str = Query("", description="YYYY-MM-DD"),
    kasir: str = Query("", description="filter per kasir (nama)"),
    skip: int = 0, limit: int = 500,
    db: Session = Depends(get_db), _: models.User = Depends(get_current_user),
):
    rows = db.query(models.Sale).all()
    rows.sort(key=lambda r: r.id or 0, reverse=True)
    if dari or sampai:
        rows = [r for r in rows if _in_range(r.tanggal or "", dari, sampai)]
    if kasir:
        rows = [r for r in rows if _match_kasir(r.kasir, kasir)]
    if q:
        ql = q.lower()
        rows = [r for r in rows if ql in " ".join([
            r.no_nota or "", r.pelanggan or "", r.telp or "", r.kasir or "",
        ]).lower()]
    return [_sale_to_out(r) for r in rows[skip: skip + limit]]


@router.get("/sales/{sale_id}", response_model=schemas.SaleOut)
def get_sale(sale_id: int, db: Session = Depends(get_db),
             _: models.User = Depends(get_current_user)):
    s = db.get(models.Sale, sale_id)
    if not s:
        raise HTTPException(404, "Nota tidak ditemukan")
    return _sale_to_out(s)


@router.delete("/sales/{sale_id}")
def delete_sale(sale_id: int, db: Session = Depends(get_db),
                __: models.User = Depends(require_admin)):
    s = db.get(models.Sale, sale_id)
    if not s:
        raise HTTPException(404, "Nota tidak ditemukan")
    # kembalikan stok
    for it in (s.items or []):
        if it.sparepart_id:
            sp = db.get(models.Sparepart, it.sparepart_id)
            if sp:
                sp.stok = (sp.stok or 0) + (it.qty or 0)
    db.delete(s)
    db.commit()
    return {"ok": True}


@router.get("/stats/report", response_model=schemas.ReportOut, dependencies=[Depends(require_kasir_laba)])
def report(
    dari: str = Query("", description="YYYY-MM-DD, kosong = semua"),
    sampai: str = Query("", description="YYYY-MM-DD, kosong = semua"),
    kasir: str = Query("", description="filter laporan per kasir (nama), kosong = semua"),
    sesi_id: int = Query(0, description="ID sesi kasir; >0 = laporan per sesi (lintas tanggal)"),
    db: Session = Depends(get_db), user: models.User = Depends(get_current_user),
):
    sess = _session_or_404(db, sesi_id, user) if sesi_id else None
    if sess is not None:
        services, diambil, sales, expenses = _collect_session(db, sess)
        digital = []
        dari = sess.opened_at.date().isoformat() if sess.opened_at else dari
        sampai = (sess.closed_at or datetime.utcnow()).date().isoformat()
        kasir = (sess.kasir or "").strip()
    else:
        services, sales, expenses, digital = _collect_periode(db, dari, sampai, kasir)
        # Omzet service HANYA dari status Diambil.
        diambil = [r for r in services if _norm_status(r.status) == "Diambil"]
    spares = db.query(models.Sparepart).all()
    service_omzet = sum(int(r.biaya or 0) for r in diambil)
    # Kebijakan konter: pembelian sparepart dicatat sebagai biaya, jadi laba
    # service = omzet penuh (tidak ada HPP per-service).
    service_hpp = 0
    service_laba = service_omzet
    penjualan_subtotal = sum(_sale_subtotal(r) for r in sales)
    penjualan_diskon = sum(_sale_diskon(r) for r in sales)
    # Omzet penjualan = subtotal - diskon (total bersih yang dibayar pembeli).
    penjualan_omzet = sum(int(r.total or 0) for r in sales)
    penjualan_hpp = sum(int(r.hpp_total or 0) for r in sales)
    penjualan_laba = penjualan_omzet - penjualan_hpp
    # Penjualan Digital
    digital_omzet = sum(int(getattr(r, "harga_jual", 0) or 0) for r in digital)
    digital_hpp = sum(int(getattr(r, "hpp", 0) or 0) for r in digital)
    digital_laba = sum(
        int(getattr(r, "margin", 0) or (int(getattr(r, "harga_jual", 0) or 0) - int(getattr(r, "hpp", 0) or 0)))
        for r in digital
    )
    penjualan_omzet_total = penjualan_omzet + digital_omzet
    penjualan_hpp_total = penjualan_hpp + digital_hpp
    penjualan_laba_total = penjualan_laba + digital_laba
    income = [r for r in expenses if _is_income(r)]
    biaya = [r for r in expenses if not _is_income(r)]
    expense_total = sum(int(getattr(r, "jumlah", 0) or 0) for r in biaya)
    income_total = sum(int(getattr(r, "jumlah", 0) or 0) for r in income)
    expense_service = sum(int(getattr(r, "jumlah", 0) or 0) for r in biaya
                          if _expense_sumber(r) == "service")
    expense_penjualan = sum(int(getattr(r, "jumlah", 0) or 0) for r in biaya
                            if _expense_sumber(r) == "penjualan")
    income_service = sum(int(getattr(r, "jumlah", 0) or 0) for r in income
                         if _expense_sumber(r) == "service")
    income_penjualan = sum(int(getattr(r, "jumlah", 0) or 0) for r in income
                           if _expense_sumber(r) == "penjualan")
    expense_tanpa_sumber = expense_total - expense_service - expense_penjualan
    income_tanpa_sumber = income_total - income_service - income_penjualan
    service_omzet_bersih = service_omzet - expense_service + income_service
    penjualan_omzet_bersih = penjualan_omzet_total - expense_penjualan + income_penjualan
    total_pendapatan = service_omzet + penjualan_omzet_total + income_total
    total_hpp = penjualan_hpp_total + service_hpp
    laba_kotor = total_pendapatan - total_hpp
    laba_operasional = laba_kotor - expense_total
    # Total laba (bersih) = omzet service + laba penjualan + pendapatan lain - biaya.
    total_laba = laba_operasional
    margin_persen = round((total_laba / total_pendapatan) * 100, 2) if total_pendapatan else 0.0
    diambil_sorted = sorted(diambil, key=lambda r: r.id or 0, reverse=True)[:50]
    return {
        "dari": dari or "", "sampai": sampai or "", "kasir": kasir,
        "sesi_id": int(sess.id) if sess is not None else 0,
        "service_masuk": len(services),
        "service_selesai": len(diambil),
        "service_omzet": service_omzet,
        "service_hpp": service_hpp,
        "service_laba": service_laba,
        "service_per_status": {st: sum(1 for r in services if _norm_status(r.status) == st) for st in STATUS_SERVICE},
        "service_diambil": [
            {"noService": r.no_service or "", "tanggal": r.tanggal or "", "nama": r.nama or "",
             "telp": r.telp or "", "merk": r.merk or "", "tipe": r.tipe or "",
             "biaya": r.biaya or 0, "teknisi": r.teknisi or "",
             "kasir": getattr(r, "kasir", "") or ""}
            for r in diambil_sorted
        ],
        "penjualan_count": len(sales),
        "penjualan_subtotal": penjualan_subtotal + digital_omzet,
        "penjualan_diskon": penjualan_diskon,
        "penjualan_omzet": penjualan_omzet_total,
        "penjualan_hpp": penjualan_hpp_total,
        "penjualan_laba": penjualan_laba_total,
        "digital_count": len(digital),
        "digital_omzet": digital_omzet,
        "digital_hpp": digital_hpp,
        "digital_laba": digital_laba,
        "expense_count": len(biaya),
        "expense_total": expense_total,
        "expense_service": expense_service,
        "expense_penjualan": expense_penjualan,
        "expense_tanpa_sumber": expense_tanpa_sumber,
        "income_count": len(income),
        "income_total": income_total,
        "income_service": income_service,
        "income_penjualan": income_penjualan,
        "income_tanpa_sumber": income_tanpa_sumber,
        "service_omzet_bersih": service_omzet_bersih,
        "penjualan_omzet_bersih": penjualan_omzet_bersih,
        "total_hpp": total_hpp,
        "total_pendapatan": total_pendapatan,
        "laba_kotor": laba_kotor,
        "laba_operasional": laba_operasional,
        "total_laba": total_laba,
        "laba_bersih": total_laba,
        "margin_persen": margin_persen,
        "beban_per_kategori": _group_uang(biaya),
        "pendapatan_per_kategori": _group_uang(income),
        "stok_item": len(spares),
        "stok_nilai_hpp": sum(int(s.hpp or 0) * int(s.stok or 0) for s in spares),
        "stok_nilai_jual": sum(int(s.harga_jual or 0) * int(s.stok or 0) for s in spares),
        "stok_menipis": sum(1 for s in spares if int(s.stok or 0) <= int(s.stok_min or 0)),
    }


@router.get("/stats/arus-kas", dependencies=[Depends(require_kasir_laba)])
def arus_kas(
    dari: str = Query("", description="YYYY-MM-DD, kosong = semua"),
    sampai: str = Query("", description="YYYY-MM-DD, kosong = semua"),
    kasir: str = Query("", description="filter per kasir (nama), kosong = semua"),
    sesi_id: int = Query(0, description="ID sesi kasir; >0 = arus kas per sesi"),
    db: Session = Depends(get_db), user: models.User = Depends(get_current_user),
):
    """Arus kas sederhana (cash basis): hanya transaksi tunai yang dihitung."""
    sess = _session_or_404(db, sesi_id, user) if sesi_id else None
    if sess is not None:
        _services_created, diambil, sales, expenses = _collect_session(db, sess)
        dari = sess.opened_at.date().isoformat() if sess.opened_at else dari
        sampai = (sess.closed_at or datetime.utcnow()).date().isoformat()
        kasir = (sess.kasir or "").strip()
    else:
        services, sales, expenses, _digital = _collect_periode(db, dari, sampai, kasir)
        diambil = [r for r in services if _norm_status(r.status) == "Diambil"]
    service_tunai = sum(int(r.biaya or 0) for r in diambil
                        if _is_tunai_metode(getattr(r, "metode_bayar", "tunai")))
    service_non = sum(int(r.biaya or 0) for r in diambil
                      if not _is_tunai_metode(getattr(r, "metode_bayar", "tunai")))
    penjualan_tunai = sum(int(r.total or 0) for r in sales if _is_tunai_metode(r.metode))
    penjualan_non = sum(int(r.total or 0) for r in sales if not _is_tunai_metode(r.metode))
    biaya = [r for r in expenses if not _is_income(r)]
    income = [r for r in expenses if _is_income(r)]
    biaya_tunai = sum(int(getattr(r, "jumlah", 0) or 0) for r in biaya
                      if _is_tunai_metode(getattr(r, "metode", "tunai")))
    biaya_non = sum(int(getattr(r, "jumlah", 0) or 0) for r in biaya
                    if not _is_tunai_metode(getattr(r, "metode", "tunai")))
    biaya_svc_tunai = sum(int(getattr(r, "jumlah", 0) or 0) for r in biaya
                          if _expense_sumber(r) == "service"
                          and _is_tunai_metode(getattr(r, "metode", "tunai")))
    biaya_jual_tunai = sum(int(getattr(r, "jumlah", 0) or 0) for r in biaya
                           if _expense_sumber(r) == "penjualan"
                           and _is_tunai_metode(getattr(r, "metode", "tunai")))
    biaya_svc_non = sum(int(getattr(r, "jumlah", 0) or 0) for r in biaya
                        if _expense_sumber(r) == "service"
                        and not _is_tunai_metode(getattr(r, "metode", "tunai")))
    biaya_jual_non = sum(int(getattr(r, "jumlah", 0) or 0) for r in biaya
                         if _expense_sumber(r) == "penjualan"
                         and not _is_tunai_metode(getattr(r, "metode", "tunai")))
    income_tunai = sum(int(getattr(r, "jumlah", 0) or 0) for r in income
                       if _is_tunai_metode(getattr(r, "metode", "tunai")))
    income_non = sum(int(getattr(r, "jumlah", 0) or 0) for r in income
                     if not _is_tunai_metode(getattr(r, "metode", "tunai")))
    income_svc_tunai = sum(int(getattr(r, "jumlah", 0) or 0) for r in income
                           if _expense_sumber(r) == "service"
                           and _is_tunai_metode(getattr(r, "metode", "tunai")))
    income_jual_tunai = sum(int(getattr(r, "jumlah", 0) or 0) for r in income
                            if _expense_sumber(r) == "penjualan"
                            and _is_tunai_metode(getattr(r, "metode", "tunai")))
    income_svc_non = sum(int(getattr(r, "jumlah", 0) or 0) for r in income
                         if _expense_sumber(r) == "service"
                         and not _is_tunai_metode(getattr(r, "metode", "tunai")))
    income_jual_non = sum(int(getattr(r, "jumlah", 0) or 0) for r in income
                          if _expense_sumber(r) == "penjualan"
                          and not _is_tunai_metode(getattr(r, "metode", "tunai")))
    penerimaan_total = service_tunai + penjualan_tunai + income_tunai
    arus_bersih = penerimaan_total - biaya_tunai

    # Sesi kasir dalam periode (untuk modal awal & selisih kas fisik).
    from .kas_sessions import _to_out as _kas_to_out
    if sess is not None:
        sessions = [sess]
        kas_awal = int(sess.modal_awal or 0)
    else:
        sessions = _sessions_periode(db, dari, sampai, kasir)
        kas_awal = _opening_cash(sessions)
    sesi = [_kas_to_out(s, db) for s in sessions]
    kas_akhir_sistem = kas_awal + arus_bersih
    return {
        "dari": dari or "", "sampai": sampai or "", "kasir": kasir,
        "sesi_id": int(sess.id) if sess is not None else 0,
        "kas_awal": kas_awal,
        "penerimaan": {
            "service_tunai": service_tunai,
            "penjualan_tunai": penjualan_tunai,
            "pendapatan_lain_tunai": income_tunai,
            "pendapatan_lain_service_tunai": income_svc_tunai,
            "pendapatan_lain_penjualan_tunai": income_jual_tunai,
            "pendapatan_lain_belum_tunai": income_tunai - income_svc_tunai - income_jual_tunai,
            "total": penerimaan_total,
        },
        "pengeluaran": {
            "biaya_tunai": biaya_tunai,
            "biaya_service_tunai": biaya_svc_tunai,
            "biaya_penjualan_tunai": biaya_jual_tunai,
            "biaya_belum_tunai": biaya_tunai - biaya_svc_tunai - biaya_jual_tunai,
            "total": biaya_tunai,
        },
        "arus_kas_bersih": arus_bersih,
        "kas_akhir_sistem": kas_akhir_sistem,
        "non_tunai": {
            "service": service_non,
            "penjualan": penjualan_non,
            "pendapatan_lain": income_non,
            "pendapatan_lain_service": income_svc_non,
            "pendapatan_lain_penjualan": income_jual_non,
            "pendapatan_lain_belum": income_non - income_svc_non - income_jual_non,
            "pengeluaran": biaya_non,
            "pengeluaran_service": biaya_svc_non,
            "pengeluaran_penjualan": biaya_jual_non,
            "pengeluaran_belum": biaya_non - biaya_svc_non - biaya_jual_non,
        },
        "sesi": sesi,
    }


@router.get("/stats/neraca", dependencies=[Depends(require_kasir_laba)])
def neraca(
    tanggal: str = Query("", description="YYYY-MM-DD, kosong = hari ini"),
    kasir: str = Query("", description="filter per kasir (nama), kosong = semua"),
    sesi_id: int = Query(0, description="ID sesi kasir; >0 = snapshot akhir sesi"),
    db: Session = Depends(get_db), user: models.User = Depends(get_current_user),
):
    """Posisi keuangan ringkas per tanggal / akhir sesi (bukan double-entry)."""
    sess = _session_or_404(db, sesi_id, user) if sesi_id else None
    if sess is not None:
        t0, t1 = _session_window(sess)
        services, sales, expenses = _collect_until(db, t1, sess.kasir or "")
        digital = []
        sampai = t1.date().isoformat()
        kasir = (sess.kasir or "").strip()
    else:
        sampai = (tanggal or "").strip()[:10] or datetime.now().date().isoformat()
        services, sales, expenses, digital = _collect_periode(db, "", sampai, kasir)
    spares = db.query(models.Sparepart).all()
    diambil = [r for r in services if _norm_status(r.status) == "Diambil"]
    service_omzet = sum(int(r.biaya or 0) for r in diambil)
    penjualan_omzet = sum(int(r.total or 0) for r in sales)
    penjualan_hpp = sum(int(r.hpp_total or 0) for r in sales)
    digital_omzet = sum(int(getattr(r, "harga_jual", 0) or 0) for r in digital)
    digital_hpp = sum(int(getattr(r, "hpp", 0) or 0) for r in digital)
    digital_laba = sum(
        int(getattr(r, "margin", 0) or (int(getattr(r, "harga_jual", 0) or 0) - int(getattr(r, "hpp", 0) or 0)))
        for r in digital
    )
    income_total = sum(int(getattr(r, "jumlah", 0) or 0) for r in expenses if _is_income(r))
    expense_total = sum(int(getattr(r, "jumlah", 0) or 0) for r in expenses if not _is_income(r))
    laba_ditahan = (service_omzet + (penjualan_omzet - penjualan_hpp)
                    + digital_laba + income_total - expense_total)

    if sess is not None:
        sessions = [
            s for s in db.query(models.CashSession).all()
            if (s.opened_at or datetime.min) <= t1
            and (not kasir or _match_kasir(s.kasir, kasir))
        ]
    else:
        sessions = _sessions_periode(db, "", sampai, kasir)
    from .kas_sessions import _to_out as _kas_to_out
    latest: dict[str, dict] = {}
    for s in sessions:
        key = " ".join((s.kasir or "").split()).casefold() or "-"
        if key not in latest or (s.opened_at or datetime.min) > (latest[key]["_t"]):
            latest[key] = {"_t": s.opened_at or datetime.min, "row": _kas_to_out(s, db)}
    kas = sum(int(r["row"].get("kas_akhir" if r["row"].get("status") == "closed" else "kas_sistem", 0) or 0)
              for r in latest.values())
    if not latest:
        # Belum ada sesi: pakai arus kas kumulatif sebagai perkiraan kas.
        service_tunai = sum(int(r.biaya or 0) for r in diambil
                            if _is_tunai_metode(getattr(r, "metode_bayar", "tunai")))
        penjualan_tunai = sum(int(r.total or 0) for r in sales if _is_tunai_metode(r.metode))
        income_tunai = sum(int(getattr(r, "jumlah", 0) or 0) for r in expenses
                           if _is_income(r) and _is_tunai_metode(getattr(r, "metode", "tunai")))
        biaya_tunai = sum(int(getattr(r, "jumlah", 0) or 0) for r in expenses
                          if not _is_income(r) and _is_tunai_metode(getattr(r, "metode", "tunai")))
        kas = service_tunai + penjualan_tunai + income_tunai - biaya_tunai

    modal = _opening_cash(sessions)
    stok_hpp = sum(int(s.hpp or 0) * int(s.stok or 0) for s in spares)
    total_aset = kas + stok_hpp
    total_ekuitas = modal + laba_ditahan
    return {
        "sampai": sampai, "kasir": kasir,
        "sesi_id": int(sess.id) if sess is not None else 0,
        "aset": {
            "kas": kas,
            "stok_hpp": stok_hpp,
            "total": total_aset,
        },
        "kewajiban": {"total": 0},
        "ekuitas": {
            "modal": modal,
            "laba_ditahan": laba_ditahan,
            "total": total_ekuitas,
        },
        "selisih": total_aset - total_ekuitas,
        "catatan": (
            "Posisi keuangan ringkas. Pembelian stok dicatat sebagai biaya, "
            "sehingga nilai stok di aset bisa membuat selisih terhadap ekuitas."
        ),
    }


@router.get("/stats/per-kategori", dependencies=[Depends(require_kasir_laba)])
def per_kategori(
    dari: str = Query("", description="YYYY-MM-DD, kosong = semua"),
    sampai: str = Query("", description="YYYY-MM-DD, kosong = semua"),
    kasir: str = Query("", description="filter per kasir (nama), kosong = semua"),
    sesi_id: int = Query(0, description="ID sesi kasir; >0 = laba per kategori per sesi"),
    db: Session = Depends(get_db), user: models.User = Depends(get_current_user),
):
    """Laba per kategori produk, per kode digital, dan per merk service."""
    sess = _session_or_404(db, sesi_id, user) if sesi_id else None
    if sess is not None:
        _services_created, services, sales, _expenses = _collect_session(db, sess)
        digital = []
        dari = sess.opened_at.date().isoformat() if sess.opened_at else dari
        sampai = (sess.closed_at or datetime.utcnow()).date().isoformat()
        kasir = (sess.kasir or "").strip()
    else:
        services, sales, _expenses, digital = _collect_periode(db, dari, sampai, kasir)
    sp_by_id = {s.id: s for s in db.query(models.Sparepart).all()}

    produk: dict[str, dict] = {}
    for sale in sales:
        items = sale.items or []
        gross = sum(int(it.subtotal or (int(it.harga or 0) * int(it.qty or 0))) for it in items)
        ratio = (int(sale.total or 0) / gross) if gross else 1
        for it in items:
            sp = sp_by_id.get(it.sparepart_id)
            kat = ((getattr(sp, "kategori", "") or "Lainnya").strip() or "Lainnya") if sp else "Lainnya"
            row = produk.setdefault(kat, {"kategori": kat, "qty": 0, "omzet": 0, "hpp": 0, "laba": 0})
            qty = int(it.qty or 0)
            omzet = int(round(int(it.subtotal or (int(it.harga or 0) * qty)) * ratio))
            hpp = int(it.hpp or 0) * qty
            row["qty"] += qty
            row["omzet"] += omzet
            row["hpp"] += hpp
            row["laba"] += omzet - hpp

    digital_rows: dict[str, dict] = {}
    for d in digital:
        kode = (getattr(d, "kode", "") or "Lainnya").strip() or "Lainnya"
        row = digital_rows.setdefault(kode, {"kode": kode, "qty": 0, "omzet": 0, "hpp": 0, "laba": 0})
        omzet = int(getattr(d, "harga_jual", 0) or 0)
        hpp = int(getattr(d, "hpp", 0) or 0)
        laba = int(getattr(d, "margin", 0) or (omzet - hpp))
        row["qty"] += 1
        row["omzet"] += omzet
        row["hpp"] += hpp
        row["laba"] += laba

    service_rows: dict[str, dict] = {}
    for s in services:
        if _norm_status(s.status) != "Diambil":
            continue
        merk = (s.merk or "Lainnya").strip() or "Lainnya"
        row = service_rows.setdefault(merk, {"merk": merk, "jumlah": 0, "omzet": 0})
        row["jumlah"] += 1
        row["omzet"] += int(s.biaya or 0)

    return {
        "dari": dari or "", "sampai": sampai or "", "kasir": kasir,
        "sesi_id": int(sess.id) if sess is not None else 0,
        "produk": sorted(produk.values(), key=lambda x: (-x["laba"], x["kategori"].lower())),
        "digital": sorted(digital_rows.values(), key=lambda x: (-x["laba"], x["kode"].lower())),
        "service": sorted(service_rows.values(), key=lambda x: (-x["omzet"], x["merk"].lower())),
    }



@router.get("/stats/harian", dependencies=[Depends(require_kasir_laba)])
def report_harian(
    dari: str = Query("", description="YYYY-MM-DD, kosong = semua"),
    sampai: str = Query("", description="YYYY-MM-DD, kosong = semua"),
    kasir: str = Query("", description="filter per kasir (nama), kosong = semua"),
    sesi_id: int = Query(0, description="ID sesi kasir; >0 = rekap harian per sesi"),
    db: Session = Depends(get_db), user: models.User = Depends(get_current_user),
):
    """Rekap HARIAN per kasir: satu baris per (tanggal, kasir).

    Dipakai untuk melihat performa tiap kasir per hari: berapa service masuk,
    berapa yang Diambil (+omzetnya), berapa nota penjualan, pengeluaran, laba,
    dan berapa notifikasi WhatsApp yang sudah dikirim.
    """
    sess = _session_or_404(db, sesi_id, user) if sesi_id else None
    picked_ids: set[int] = set()
    created_ids: set[int] = set()
    if sess is not None:
        services_created, services_diambil, sales, expenses = _collect_session(db, sess)
        created_ids = {s.id for s in services_created}
        picked_ids = {s.id for s in services_diambil}
        services = services_created + [s for s in services_diambil if s.id not in created_ids]
        digital = []
        dari = sess.opened_at.date().isoformat() if sess.opened_at else dari
        sampai = (sess.closed_at or datetime.utcnow()).date().isoformat()
        kasir = (sess.kasir or "").strip()
    else:
        services = db.query(models.Service).all()
        sales = db.query(models.Sale).all()
        try:
            expenses = db.query(models.Expense).all()
        except Exception:
            expenses = []
        try:
            digital = db.query(models.DigitalSale).all()
        except Exception:
            digital = []
        if dari or sampai:
            services = [r for r in services if _in_range(r.tanggal or "", dari, sampai)]
            sales = [r for r in sales if _in_range(r.tanggal or "", dari, sampai)]
            expenses = [r for r in expenses if _in_range(getattr(r, "tanggal", "") or "", dari, sampai)]
            digital = [r for r in digital if _in_range(getattr(r, "tanggal", "") or "", dari, sampai)]
        kasir = (kasir or "").strip()
        if kasir:
            services = [r for r in services if _match_kasir(getattr(r, "kasir", ""), kasir)]
            sales = [r for r in sales if _match_kasir(r.kasir, kasir)]
            expenses = [r for r in expenses if _match_kasir(getattr(r, "dicatat_oleh", ""), kasir)]
            digital = []

    rows: dict[tuple[str, str], dict] = {}

    def _row(tgl: str, nama: str) -> dict:
        key = (tgl, nama)
        if key not in rows:
            rows[key] = {
                "tanggal": tgl, "kasir": nama,
                "svc_masuk": 0, "svc_diambil": 0, "svc_omzet": 0,
                "nota": 0, "jual_omzet": 0, "jual_laba": 0,
                "digital_count": 0, "digital_omzet": 0, "digital_laba": 0,
                "exp_n": 0, "exp": 0, "inc_n": 0, "inc": 0, "wa_terkirim": 0,
                "total_pendapatan": 0, "total_laba": 0,
            }
        return rows[key]

    for s in services:
        tgl = (s.tanggal or "")[:10]
        nama = (getattr(s, "kasir", "") or "").strip() or "-"
        r = _row(tgl, nama)
        if sess is None or s.id in created_ids:
            r["svc_masuk"] += 1
        diambil_now = (_norm_status(s.status) == "Diambil") if sess is None else (s.id in picked_ids)
        if diambil_now:
            r["svc_diambil"] += 1
            r["svc_omzet"] += int(s.biaya or 0)
        if getattr(s, "wa_terkirim_at", None):
            r["wa_terkirim"] += 1

    for s in sales:
        tgl = (s.tanggal or "")[:10]
        nama = (s.kasir or "").strip() or "-"
        r = _row(tgl, nama)
        r["nota"] += 1
        r["jual_omzet"] += int(s.total or 0)
        r["jual_laba"] += int(s.laba if s.laba is not None else (int(s.total or 0) - int(s.hpp_total or 0)))

    for d in digital:
        tgl = (getattr(d, "tanggal", "") or datetime.now().date().isoformat())[:10]
        nama = "Digital"
        r = _row(tgl, nama)
        r["digital_count"] += 1
        hj = int(getattr(d, "harga_jual", 0) or 0)
        hpp_d = int(getattr(d, "hpp", 0) or 0)
        mg = int(getattr(d, "margin", 0) or (hj - hpp_d))
        r["jual_omzet"] += hj
        r["jual_laba"] += mg
        r["digital_omzet"] += hj
        r["digital_laba"] += mg
        r["nota"] += 1

    for e in expenses:
        tgl = (getattr(e, "tanggal", "") or "")[:10]
        nama = (getattr(e, "dicatat_oleh", "") or "").strip() or "-"
        r = _row(tgl, nama)
        if _is_income(e):
            r["inc_n"] += 1
            r["inc"] += int(getattr(e, "jumlah", 0) or 0)
        else:
            r["exp_n"] += 1
            r["exp"] += int(getattr(e, "jumlah", 0) or 0)

    out = []
    for r in rows.values():
        r["total_pendapatan"] = r["svc_omzet"] + r["jual_omzet"] + r["inc"]
        r["total_laba"] = r["svc_omzet"] + r["jual_laba"] + r["inc"] - r["exp"]
        out.append(r)
    out.sort(key=lambda r: (r["tanggal"], r["kasir"]), reverse=True)

    ringkasan = {
        "hari": len({r["tanggal"] for r in out}),
        "svc_masuk": sum(r["svc_masuk"] for r in out),
        "svc_diambil": sum(r["svc_diambil"] for r in out),
        "svc_omzet": sum(r["svc_omzet"] for r in out),
        "nota": sum(r["nota"] for r in out),
        "jual_omzet": sum(r["jual_omzet"] for r in out),
        "jual_laba": sum(r["jual_laba"] for r in out),
        "exp": sum(r["exp"] for r in out),
        "inc": sum(r["inc"] for r in out),
        "wa_terkirim": sum(r["wa_terkirim"] for r in out),
        "total_pendapatan": sum(r["total_pendapatan"] for r in out),
        "total_laba": sum(r["total_laba"] for r in out),
    }
    return {"dari": dari or "", "sampai": sampai or "", "kasir": kasir,
            "sesi_id": int(sess.id) if sess is not None else 0,
            "rows": out, "ringkasan": ringkasan}
