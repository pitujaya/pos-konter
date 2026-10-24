"""CRUD /api/sales (penjualan barang) + /api/stats/report (laporan)."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas
from ..auth import get_current_user, require_admin

router = APIRouter(tags=["sales"])
STATUS_SERVICE = ["Dikerjakan", "Selesai", "Diambil", "Cancel"]
STATUS_NORM = {"Antri": "Dikerjakan", "Menunggu Sparepart": "Dikerjakan", "Batal": "Cancel"}


def _norm_status(s: str | None) -> str:
    s = (s or "").strip()
    s = STATUS_NORM.get(s, s)
    return s if s in STATUS_SERVICE else "Dikerjakan"


def _is_income(e) -> bool:
    return str(getattr(e, "jenis", "biaya") or "biaya").strip().lower() == "pendapatan"


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


@router.get("/stats/report", response_model=schemas.ReportOut)
def report(
    dari: str = Query("", description="YYYY-MM-DD, kosong = semua"),
    sampai: str = Query("", description="YYYY-MM-DD, kosong = semua"),
    kasir: str = Query("", description="filter laporan per kasir (nama), kosong = semua"),
    db: Session = Depends(get_db), _: models.User = Depends(get_current_user),
):
    services = db.query(models.Service).all()
    sales = db.query(models.Sale).all()
    spares = db.query(models.Sparepart).all()
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
    # Omzet service HANYA dari status Diambil
    diambil = [r for r in services if _norm_status(r.status) == "Diambil"]
    service_omzet = sum(int(r.biaya or 0) for r in diambil)
    penjualan_subtotal = sum(_sale_subtotal(r) for r in sales)
    penjualan_diskon = sum(_sale_diskon(r) for r in sales)
    # Omzet penjualan = subtotal - diskon (total bersih yang dibayar pembeli).
    penjualan_omzet = sum(int(r.total or 0) for r in sales)
    penjualan_hpp = sum(int(r.hpp_total or 0) for r in sales)
    penjualan_laba = penjualan_omzet - penjualan_hpp
    # Penjualan Digital
    digital_omzet = sum(int(getattr(r, "harga_jual", 0) or 0) for r in digital)
    digital_hpp = sum(int(getattr(r, "hpp", 0) or 0) for r in digital)
    digital_laba = sum(int(getattr(r, "margin", 0) or (int(getattr(r, "harga_jual", 0) or 0) - int(getattr(r, "hpp", 0) or 0))) for r in digital)
    penjualan_omzet_total = penjualan_omzet + digital_omzet
    penjualan_hpp_total = penjualan_hpp + digital_hpp
    penjualan_laba_total = penjualan_laba + digital_laba
    income = [r for r in expenses if _is_income(r)]
    biaya = [r for r in expenses if not _is_income(r)]
    expense_total = sum(int(getattr(r, "jumlah", 0) or 0) for r in biaya)
    income_total = sum(int(getattr(r, "jumlah", 0) or 0) for r in income)
    # Laba service dianggap = omzet jasa (tanpa HPP tercatat).
    # Total laba (bersih) = omzet service + laba penjualan + pendapatan lain - biaya.
    total_laba = service_omzet + penjualan_laba_total + income_total - expense_total
    diambil_sorted = sorted(diambil, key=lambda r: r.id or 0, reverse=True)[:50]
    return {
        "dari": dari or "", "sampai": sampai or "", "kasir": kasir,
        "service_masuk": len(services),
        "service_selesai": len(diambil),
        "service_omzet": service_omzet,
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
        "income_count": len(income),
        "income_total": income_total,
        "total_pendapatan": service_omzet + penjualan_omzet_total + income_total,
        "total_laba": total_laba,
        "stok_item": len(spares),
        "stok_nilai_hpp": sum(int(s.hpp or 0) * int(s.stok or 0) for s in spares),
        "stok_nilai_jual": sum(int(s.harga_jual or 0) * int(s.stok or 0) for s in spares),
        "stok_menipis": sum(1 for s in spares if int(s.stok or 0) <= int(s.stok_min or 0)),
    }


@router.get("/stats/harian")
def report_harian(
    dari: str = Query("", description="YYYY-MM-DD, kosong = semua"),
    sampai: str = Query("", description="YYYY-MM-DD, kosong = semua"),
    kasir: str = Query("", description="filter per kasir (nama), kosong = semua"),
    db: Session = Depends(get_db), _: models.User = Depends(get_current_user),
):
    """Rekap HARIAN per kasir: satu baris per (tanggal, kasir).

    Dipakai untuk melihat performa tiap kasir per hari: berapa service masuk,
    berapa yang Diambil (+omzetnya), berapa nota penjualan, pengeluaran, laba,
    dan berapa notifikasi WhatsApp yang sudah dikirim.
    """
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
        r["svc_masuk"] += 1
        if _norm_status(s.status) == "Diambil":
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
            "rows": out, "ringkasan": ringkasan}
