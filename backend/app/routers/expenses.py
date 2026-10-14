"""CRUD /api/expenses (pengeluaran / biaya operasional)."""
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas
from ..auth import get_current_user, require_admin

router = APIRouter(tags=["expenses"])


def _expense_to_out(e: models.Expense) -> dict:
    return {
        "id": e.id,
        "tanggal": e.tanggal or "",
        "kategori": e.kategori or "Lainnya",
        "keterangan": e.keterangan or "",
        "jumlah": int(e.jumlah or 0),
        "dicatat_oleh": e.dicatat_oleh or "",
    }


def _in_range(tgl: str, dari: str, sampai: str) -> bool:
    t = (tgl or "")[:10]
    if dari and t < dari[:10]:
        return False
    if sampai and t > sampai[:10]:
        return False
    return True


@router.post("/expenses", response_model=schemas.ExpenseOut, status_code=201)
def create_expense(body: schemas.ExpenseIn, db: Session = Depends(get_db),
                   user: models.User = Depends(get_current_user)):
    jumlah = int(body.jumlah or 0)
    if jumlah <= 0:
        raise HTTPException(400, "Jumlah pengeluaran harus lebih dari 0")
    tanggal = ((body.tanggal or "")[:10] or datetime.now().date().isoformat())
    kategori = (body.kategori or "Lainnya").strip() or "Lainnya"
    e = models.Expense(
        tanggal=tanggal,
        kategori=kategori,
        keterangan=(body.keterangan or "").strip(),
        jumlah=jumlah,
        dicatat_oleh=user.nama or "",
    )
    db.add(e)
    db.commit()
    db.refresh(e)
    return _expense_to_out(e)


@router.get("/expenses", response_model=list[schemas.ExpenseOut])
def list_expenses(
    q: str = Query("", description="cari kategori / keterangan / pencatat"),
    dari: str = Query("", description="YYYY-MM-DD"),
    sampai: str = Query("", description="YYYY-MM-DD"),
    skip: int = 0, limit: int = 500,
    db: Session = Depends(get_db), _: models.User = Depends(get_current_user),
):
    rows = db.query(models.Expense).all()
    rows.sort(key=lambda r: r.id or 0, reverse=True)
    if dari or sampai:
        rows = [r for r in rows if _in_range(r.tanggal or "", dari, sampai)]
    if q:
        ql = q.lower()
        rows = [r for r in rows if ql in " ".join([
            r.kategori or "", r.keterangan or "", r.dicatat_oleh or "", r.tanggal or "",
        ]).lower()]
    return [_expense_to_out(r) for r in rows[skip: skip + limit]]


@router.get("/expenses/{expense_id}", response_model=schemas.ExpenseOut)
def get_expense(expense_id: int, db: Session = Depends(get_db),
                _: models.User = Depends(get_current_user)):
    e = db.get(models.Expense, expense_id)
    if not e:
        raise HTTPException(404, "Pengeluaran tidak ditemukan")
    return _expense_to_out(e)


@router.put("/expenses/{expense_id}", response_model=schemas.ExpenseOut)
def update_expense(expense_id: int, body: schemas.ExpenseUpdateIn,
                   db: Session = Depends(get_db), __: models.User = Depends(require_admin)):
    e = db.get(models.Expense, expense_id)
    if not e:
        raise HTTPException(404, "Pengeluaran tidak ditemukan")
    data = body.model_dump(exclude_unset=True)
    if "jumlah" in data and data["jumlah"] is not None:
        if int(data["jumlah"]) <= 0:
            raise HTTPException(400, "Jumlah pengeluaran harus lebih dari 0")
        e.jumlah = int(data["jumlah"])
    if "tanggal" in data and data["tanggal"]:
        e.tanggal = str(data["tanggal"])[:10]
    if "kategori" in data and data["kategori"]:
        e.kategori = str(data["kategori"]).strip() or e.kategori
    if "keterangan" in data and data["keterangan"] is not None:
        e.keterangan = str(data["keterangan"] or "").strip()
    db.commit()
    db.refresh(e)
    return _expense_to_out(e)


@router.delete("/expenses/{expense_id}")
def delete_expense(expense_id: int, db: Session = Depends(get_db),
                   __: models.User = Depends(require_admin)):
    e = db.get(models.Expense, expense_id)
    if not e:
        raise HTTPException(404, "Pengeluaran tidak ditemukan")
    db.delete(e)
    db.commit()
    return {"ok": True}
