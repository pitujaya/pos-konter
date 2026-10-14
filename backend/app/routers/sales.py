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


def _sale_to_out(s: models.Sale) -> dict:
    items = sorted(s.items or [], key=lambda x: x.id or 0)
    return {
        "id": s.id, "no_nota": s.no_nota, "tanggal": s.tanggal or "",
        "pelanggan": s.pelanggan or "", "telp": s.telp or "",
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


@router.post("/sales", response_model=schemas.SaleOut, status_code=201)
def create_sale(body: schemas.SaleIn, db: Session = Depends(get_db),
                user: models.User = Depends(get_current_user)):
    if not body.items:
        raise HTTPException(400, "Keranjang masih kosong, pilih minimal 1 barang")
    tanggal = (body.tanggal or datetime.now().date().isoformat())[:10]
    rows: list[tuple[models.Sparepart, int]] = []
    for it in body.items:
        qty = int(it.qty or 0)
        if qty <= 0:
            raise HTTPException(400, "Qty harus minimal 1")
        sp = None
        if it.sparepart_id:
            sp = db.get(models.Sparepart, int(it.sparepart_id))
        if not sp and it.sku:
            sp = db.query(models.Sparepart).filter(models.Sparepart.sku == it.sku.strip()).first()
        if not sp:
            raise HTTPException(404, f"Barang tidak ditemukan (id={it.sparepart_id} sku={it.sku})")
        if (sp.stok or 0) < qty:
            raise HTTPException(400, f"Stok {sp.nama} kurang (sisa {sp.stok}, diminta {qty})")
        rows.append((sp, qty))
    total = sum((sp.harga_jual or 0) * qty for sp, qty in rows)
    hpp_total = sum((sp.hpp or 0) * qty for sp, qty in rows)
    sale = models.Sale(
        no_nota=_gen_no_nota(db), tanggal=tanggal,
        pelanggan=(body.pelanggan or "").strip() or "Umum",
        telp=(body.telp or "").strip(),
        total=total, hpp_total=hpp_total, laba=total - hpp_total,
        metode=(body.metode or "Tunai").strip() or "Tunai",
        catatan=(body.catatan or "").strip(),
        kasir=user.nama or "",
    )
    db.add(sale)
    db.flush()
    for sp, qty in rows:
        sp.stok = (sp.stok or 0) - qty
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
    skip: int = 0, limit: int = 500,
    db: Session = Depends(get_db), _: models.User = Depends(get_current_user),
):
    rows = db.query(models.Sale).all()
    rows.sort(key=lambda r: r.id or 0, reverse=True)
    if dari or sampai:
        rows = [r for r in rows if _in_range(r.tanggal or "", dari, sampai)]
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
    db: Session = Depends(get_db), _: models.User = Depends(get_current_user),
):
    services = db.query(models.Service).all()
    sales = db.query(models.Sale).all()
    spares = db.query(models.Sparepart).all()
    try:
        expenses = db.query(models.Expense).all()
    except Exception:
        expenses = []
    if dari or sampai:
        services = [r for r in services if _in_range(r.tanggal or "", dari, sampai)]
        sales = [r for r in sales if _in_range(r.tanggal or "", dari, sampai)]
        expenses = [r for r in expenses if _in_range(getattr(r, "tanggal", "") or "", dari, sampai)]
    # Omzet service HANYA dari status Diambil
    diambil = [r for r in services if _norm_status(r.status) == "Diambil"]
    service_omzet = sum(int(r.biaya or 0) for r in diambil)
    penjualan_omzet = sum(int(r.total or 0) for r in sales)
    penjualan_hpp = sum(int(r.hpp_total or 0) for r in sales)
    penjualan_laba = penjualan_omzet - penjualan_hpp
    expense_total = sum(int(getattr(r, "jumlah", 0) or 0) for r in expenses)
    # Laba service dianggap = omzet jasa (tanpa HPP tercatat).
    # Total laba (bersih) = omzet service + laba penjualan - pengeluaran.
    total_laba = service_omzet + penjualan_laba - expense_total
    diambil_sorted = sorted(diambil, key=lambda r: r.id or 0, reverse=True)[:50]
    return {
        "dari": dari or "", "sampai": sampai or "",
        "service_masuk": len(services),
        "service_selesai": len(diambil),
        "service_omzet": service_omzet,
        "service_per_status": {st: sum(1 for r in services if _norm_status(r.status) == st) for st in STATUS_SERVICE},
        "service_diambil": [
            {"noService": r.no_service or "", "tanggal": r.tanggal or "", "nama": r.nama or "",
             "telp": r.telp or "", "merk": r.merk or "", "tipe": r.tipe or "",
             "biaya": r.biaya or 0, "teknisi": r.teknisi or ""}
            for r in diambil_sorted
        ],
        "penjualan_count": len(sales),
        "penjualan_omzet": penjualan_omzet,
        "penjualan_hpp": penjualan_hpp,
        "penjualan_laba": penjualan_laba,
        "expense_count": len(expenses),
        "expense_total": expense_total,
        "total_pendapatan": service_omzet + penjualan_omzet,
        "total_laba": total_laba,
        "stok_item": len(spares),
        "stok_nilai_hpp": sum(int(s.hpp or 0) * int(s.stok or 0) for s in spares),
        "stok_nilai_jual": sum(int(s.harga_jual or 0) * int(s.stok or 0) for s in spares),
        "stok_menipis": sum(1 for s in spares if int(s.stok or 0) <= int(s.stok_min or 0)),
    }
