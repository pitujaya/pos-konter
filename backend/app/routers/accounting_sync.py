from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..integration_auth import require_accounting_sync_key

router = APIRouter(prefix="/accounting-sync", tags=["accounting-sync"])


def valid_date(value: str) -> bool:
    if not value:
        return True
    if len(value) < 10:
        return False
    try:
        datetime.strptime(value[:10], "%Y-%m-%d")
        return True
    except ValueError:
        return False


def sale_subtotal(sale: models.Sale) -> int:
    sub = int(getattr(sale, "subtotal", 0) or 0)
    if sub:
        return sub
    return int(sale.total or 0) + int(getattr(sale, "diskon", 0) or 0)


def sale_to_out(sale: models.Sale) -> schemas.AccountingSaleOut:
    lines = sorted(sale.items or [], key=lambda x: x.id or 0)
    return schemas.AccountingSaleOut(
        transaction_id=sale.no_nota,
        id=sale.id,
        tanggal=sale.tanggal or "",
        subtotal=sale_subtotal(sale),
        diskon=int(getattr(sale, "diskon", 0) or 0),
        total=int(sale.total or 0),
        hpp_total=int(sale.hpp_total or 0),
        metode_pembayaran=sale.metode or "Tunai",
        created_at=(sale.created_at.isoformat() if getattr(sale, "created_at", None) else ""),
        items=[
            schemas.AccountingSaleLineOut(
                sparepart_id=line.sparepart_id,
                sku=line.sku or "",
                nama=line.nama or "",
                hpp=int(line.hpp or 0),
                harga=int(line.harga or 0),
                qty=int(line.qty or 0),
                subtotal=int(line.subtotal or 0),
            )
            for line in lines
        ],
    )


@router.get("/sales", response_model=schemas.AccountingSalesPageOut)
def accounting_sales(
    dari: str = Query("", max_length=32),
    sampai: str = Query("", max_length=32),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    _: str = Depends(require_accounting_sync_key),
) -> schemas.AccountingSalesPageOut:
    if not valid_date(dari) or not valid_date(sampai):
        raise HTTPException(400, "Format tanggal harus YYYY-MM-DD")

    query = db.query(models.Sale)
    if dari:
        query = query.filter(func.substr(models.Sale.tanggal, 1, 10) >= dari[:10])
    if sampai:
        query = query.filter(func.substr(models.Sale.tanggal, 1, 10) <= sampai[:10])

    total = query.count()
    rows = (
        query.order_by(models.Sale.id.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return schemas.AccountingSalesPageOut(
        page=page,
        page_size=page_size,
        total=total,
        has_more=(page * page_size) < total,
        items=[sale_to_out(row) for row in rows],
    )
