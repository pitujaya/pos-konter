"""CRUD /api/purchases: pembelian stok, HPP rata-rata tertimbang, jejak audit stok."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas
from ..auth import get_current_user, require_admin

router = APIRouter(prefix="/purchases", tags=["purchases"])


def _is_tunai(metode: str | None) -> bool:
    m = (metode or "").strip().lower()
    return m in ("", "tunai", "cash", "tunai/lunas")


def _gen_no_nota(db: Session) -> str:
    y = datetime.now().year
    n = db.query(models.Purchase).filter(models.Purchase.no_nota.like(f"PB-{y}-%")).count() + 1
    while db.query(models.Purchase).filter(models.Purchase.no_nota == f"PB-{y}-{n:04d}").first():
        n += 1
    return f"PB-{y}-{n:04d}"


def _to_out(p: models.Purchase) -> dict:
    items = sorted(p.items or [], key=lambda x: x.id or 0)
    return {
        "id": p.id,
        "no_nota": p.no_nota,
        "tanggal": p.tanggal or "",
        "supplier": p.supplier or "",
        "metode": p.metode or "Tunai",
        "catatan": p.catatan or "",
        "subtotal": p.subtotal or 0,
        "diskon": p.diskon or 0,
        "total": p.total or 0,
        "dicatat_oleh": p.dicatat_oleh or "",
        "created_at": p.created_at.isoformat() if getattr(p, "created_at", None) else "",
        "items": [
            {
                "sparepart_id": i.sparepart_id,
                "sku": i.sku or "",
                "nama": i.nama or "",
                "harga_beli": i.harga_beli or 0,
                "harga_jual": i.harga_jual or 0,
                "qty": i.qty or 0,
                "subtotal": i.subtotal or 0,
            }
            for i in items
        ],
    }


def _prepare_items(db: Session, items: list):
    per_item: dict[int, int] = {}
    cache: dict[int, models.Sparepart] = {}
    lines: list[dict] = []
    for it in items:
        qty = int(it.qty or 0)
        if qty <= 0:
            raise HTTPException(400, "Qty harus minimal 1")
        beli = int(it.harga_beli or 0)
        if beli < 0:
            raise HTTPException(400, "Harga beli tidak boleh negatif")
        sp = None
        if it.sparepart_id:
            sp = cache.get(int(it.sparepart_id))
            if sp is None:
                sp = db.get(models.Sparepart, int(it.sparepart_id))
                if sp is not None:
                    cache[sp.id] = sp
        if not sp and it.sku:
            sp = db.query(models.Sparepart).filter(models.Sparepart.sku == it.sku.strip()).first()
            if sp is not None:
                cache[sp.id] = sp
        if not sp:
            raise HTTPException(404, f"Barang tidak ditemukan (id={it.sparepart_id} sku={it.sku})")
        per_item[sp.id] = per_item.get(sp.id, 0) + qty
        jual = it.harga_jual
        lines.append({
            "sp": sp,
            "qty": qty,
            "beli": beli,
            "jual": int(jual) if jual is not None else int(sp.harga_jual or 0),
        })
    return per_item, cache, lines


def _hitung_total(lines: list[dict], diskon: int) -> tuple[int, int, int]:
    subtotal = sum(int(l["beli"]) * int(l["qty"]) for l in lines)
    diskon = max(0, min(int(diskon or 0), subtotal))
    return subtotal, diskon, subtotal - diskon


def _terapkan_stok(db: Session, per_item: dict, cache: dict, lines: list[dict],
                   no_nota: str, oleh: str) -> None:
    for sp_id, qty in per_item.items():
        sp = cache[sp_id]
        lama = int(sp.stok or 0)
        hpp_lama = int(sp.hpp or 0)
        baru = lama + qty
        total_beli = sum(int(l["beli"]) * int(l["qty"]) for l in lines if l["sp"].id == sp_id)
        beli_rata = total_beli / qty
        sp.hpp = int(round((hpp_lama * lama + beli_rata * qty) / baru)) if baru else 0
        sp.stok = baru
        db.add(models.StockAdjustment(
            sparepart_id=sp.id, nama_barang=sp.nama or "", delta=qty, stok_akhir=baru,
            alasan=f"Pembelian {no_nota}", oleh=oleh,
        ))
    for l in lines:
        if l["jual"] > 0:
            l["sp"].harga_jual = l["jual"]


def _validasi_stok(db: Session, p: models.Purchase) -> None:
    need: dict[int, int] = {}
    for it in p.items or []:
        if it.sparepart_id:
            need[int(it.sparepart_id)] = need.get(int(it.sparepart_id), 0) + int(it.qty or 0)
    for sp_id, qty in need.items():
        sp = db.get(models.Sparepart, sp_id)
        if not sp or int(sp.stok or 0) < qty:
            raise HTTPException(400, f"Stok {sp.nama if sp else sp_id} kurang untuk membatalkan nota (butuh {qty})")


def _batalkan_stok(db: Session, p: models.Purchase, oleh: str, alasan: str) -> None:
    for it in p.items or []:
        if not it.sparepart_id:
            continue
        sp = db.get(models.Sparepart, int(it.sparepart_id))
        if sp is None:
            continue
        qty = int(it.qty or 0)
        akhir = max(0, int(sp.stok or 0) - qty)
        sp.stok = akhir
        db.add(models.StockAdjustment(
            sparepart_id=sp.id, nama_barang=sp.nama or "", delta=-qty, stok_akhir=akhir,
            alasan=alasan, oleh=oleh,
        ))


@router.post("", response_model=schemas.PurchaseOut, status_code=201)
def create_purchase(body: schemas.PurchaseIn, db: Session = Depends(get_db),
                    user: models.User = Depends(require_admin)):
    from .kas_sessions import require_open_session
    require_open_session(db, user)
    per_item, cache, lines = _prepare_items(db, body.items)
    subtotal, diskon, total = _hitung_total(lines, body.diskon or 0)
    no_nota = _gen_no_nota(db)
    p = models.Purchase(
        no_nota=no_nota,
        tanggal=(body.tanggal or datetime.now().date().isoformat())[:10],
        supplier=(body.supplier or "").strip(),
        metode=(body.metode or "Tunai").strip() or "Tunai",
        catatan=(body.catatan or "").strip(),
        subtotal=subtotal, diskon=diskon, total=total,
        dicatat_oleh=user.nama or "",
    )
    db.add(p)
    db.flush()
    _terapkan_stok(db, per_item, cache, lines, no_nota, user.nama or "")
    for l in lines:
        db.add(models.PurchaseItem(
            purchase_id=p.id, sparepart_id=l["sp"].id, sku=l["sp"].sku or "",
            nama=l["sp"].nama or "", harga_beli=l["beli"], harga_jual=l["jual"],
            qty=l["qty"], subtotal=l["beli"] * l["qty"],
        ))
    db.commit()
    db.refresh(p)
    return _to_out(p)


@router.get("", response_model=list[schemas.PurchaseOut])
def list_purchases(
    q: str = Query("", description="cari no nota / supplier / catatan"),
    dari: str = Query("", description="YYYY-MM-DD"),
    sampai: str = Query("", description="YYYY-MM-DD"),
    metode: str = Query("", description="filter metode bayar"),
    skip: int = 0, limit: int = 500,
    db: Session = Depends(get_db), _: models.User = Depends(get_current_user),
):
    rows = db.query(models.Purchase).all()
    if dari:
        rows = [r for r in rows if (r.tanggal or "")[:10] >= dari[:10]]
    if sampai:
        rows = [r for r in rows if (r.tanggal or "")[:10] <= sampai[:10]]
    if metode:
        m = metode.strip().casefold()
        rows = [r for r in rows if (r.metode or "").strip().casefold() == m]
    if q:
        needle = q.strip().casefold()
        rows = [r for r in rows if needle in " ".join([
            r.no_nota or "", r.supplier or "", r.catatan or "", r.dicatat_oleh or ""
        ]).casefold()]
    rows.sort(key=lambda r: r.id or 0, reverse=True)
    return [_to_out(r) for r in rows[skip: skip + max(1, min(limit, 1000))]]


@router.get("/{purchase_id}", response_model=schemas.PurchaseOut)
def get_purchase(purchase_id: int, db: Session = Depends(get_db),
                 _: models.User = Depends(get_current_user)):
    p = db.get(models.Purchase, purchase_id)
    if not p:
        raise HTTPException(404, "Pembelian tidak ditemukan")
    return _to_out(p)


@router.put("/{purchase_id}", response_model=schemas.PurchaseOut)
def update_purchase(purchase_id: int, body: schemas.PurchaseUpdateIn,
                    db: Session = Depends(get_db), user: models.User = Depends(require_admin)):
    from .kas_sessions import require_open_session
    require_open_session(db, user)
    p = db.get(models.Purchase, purchase_id)
    if not p:
        raise HTTPException(404, "Pembelian tidak ditemukan")
    if body.items is not None:
        _validasi_stok(db, p)
        _batalkan_stok(db, p, user.nama or "", f"Pembatalan {p.no_nota} (edit)")
        for it in list(p.items or []):
            db.delete(it)
        db.flush()
        per_item, cache, lines = _prepare_items(db, body.items)
        subtotal, diskon, total = _hitung_total(lines, body.diskon if body.diskon is not None else p.diskon)
        _terapkan_stok(db, per_item, cache, lines, p.no_nota, user.nama or "")
        for l in lines:
            db.add(models.PurchaseItem(
                purchase_id=p.id, sparepart_id=l["sp"].id, sku=l["sp"].sku or "",
                nama=l["sp"].nama or "", harga_beli=l["beli"], harga_jual=l["jual"],
                qty=l["qty"], subtotal=l["beli"] * l["qty"],
            ))
    else:
        subtotal, diskon, total = p.subtotal or 0, p.diskon or 0, p.total or 0
        if body.diskon is not None:
            diskon = max(0, min(int(body.diskon), int(subtotal or 0)))
            total = int(subtotal or 0) - diskon
    if body.tanggal is not None:
        p.tanggal = body.tanggal[:10]
    if body.supplier is not None:
        p.supplier = body.supplier.strip()
    if body.metode is not None:
        p.metode = (body.metode or "Tunai").strip() or "Tunai"
    if body.catatan is not None:
        p.catatan = body.catatan.strip()
    p.subtotal = subtotal
    p.diskon = diskon
    p.total = total
    p.dicatat_oleh = p.dicatat_oleh or user.nama or ""
    db.commit()
    db.refresh(p)
    return _to_out(p)


@router.delete("/{purchase_id}")
def delete_purchase(purchase_id: int, db: Session = Depends(get_db),
                    user: models.User = Depends(require_admin)):
    p = db.get(models.Purchase, purchase_id)
    if not p:
        raise HTTPException(404, "Pembelian tidak ditemukan")
    _validasi_stok(db, p)
    _batalkan_stok(db, p, user.nama or "", f"Pembatalan {p.no_nota}")
    db.delete(p)
    db.commit()
    return {"ok": True}
