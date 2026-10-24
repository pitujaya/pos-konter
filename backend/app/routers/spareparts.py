"""CRUD /api/spareparts + lookup SKU + penyesuaian stok + import/ekspor produk masal."""
import csv
import io
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from openpyxl import Workbook, load_workbook

from ..database import get_db
from .. import models, schemas
from ..auth import get_current_user, require_admin

router = APIRouter(prefix="/spareparts", tags=["spareparts"])


def to_out(s: models.Sparepart) -> dict:
    return {
        "id": s.id, "nama": s.nama, "sku": s.sku, "merk": s.merk or "",
        "kategori": (getattr(s, "kategori", None) or "Lainnya"),
        "jenis": _norm_jenis(getattr(s, "jenis", None)),
        "hpp": s.hpp or 0, "harga_jual": s.harga_jual or 0,
        "stok": s.stok or 0, "stok_min": s.stok_min or 0,
    }


def _norm_kat(v: str | None) -> str:
    v = (v or "").strip()
    return v or "Lainnya"


JENIS_PRODUK = ("Sparepart", "Accessories", "Handphone")


def _norm_jenis(v: str | None) -> str:
    v = (v or "").strip()
    for j in JENIS_PRODUK:
        if v.lower() == j.lower():
            return j
    return "Sparepart"


@router.get("/kategoris", response_model=list[str])
def list_kategoris(db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    rows = db.query(models.Sparepart).all()
    seen: dict[str, None] = {}
    for r in rows:
        k = _norm_kat(getattr(r, "kategori", None))
        if k not in seen:
            seen[k] = None
    return sorted(seen.keys(), key=str.lower) or ["Lainnya"]


@router.get("", response_model=list[schemas.SparepartOut])
def list_spareparts(
    q: str = Query("", description="cari nama / sku / merk / kategori"),
    kategori: str = Query("", description="filter kategori persis, kosong = semua"),
    jenis: str = Query("", description="filter jenis produk: Sparepart|Accessories|Handphone"),
    sort: str = Query("nama", description="nama|sku|stok"),
    low: bool = Query(False, description="hanya stok menipis"),
    skip: int = 0, limit: int = 1000,
    db: Session = Depends(get_db), _: models.User = Depends(get_current_user),
):
    rows = db.query(models.Sparepart).all()
    if kategori and kategori != "Semua":
        kl = kategori.strip().lower()
        rows = [r for r in rows if _norm_kat(getattr(r, "kategori", None)).lower() == kl]
    if jenis and jenis != "Semua":
        jl = _norm_jenis(jenis).lower()
        rows = [r for r in rows if _norm_jenis(getattr(r, "jenis", None)).lower() == jl]
    if q:
        ql = q.lower()
        rows = [r for r in rows if ql in " ".join([r.nama or "", r.sku or "", r.merk or "", _norm_kat(getattr(r, "kategori", None))]).lower()]
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
        kategori=_norm_kat(body.kategori),
        jenis=_norm_jenis(body.jenis),
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
    if "kategori" in data:
        data["kategori"] = _norm_kat(data["kategori"])
    if "jenis" in data:
        data["jenis"] = _norm_jenis(data["jenis"])
    if "merk" in data and data["merk"] is not None:
        data["merk"] = data["merk"].strip()
    for k, v in data.items():
        if v is not None:
            setattr(s, k, v)
    db.commit()
    db.refresh(s)
    return to_out(s)


@router.patch("/{sp_id}/stock", response_model=schemas.SparepartOut)
def adjust_stock(sp_id: int, body: schemas.StockAdjustIn,
                 db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    """Sesuaikan stok manual (+/-). Setiap perubahan dicatat di log audit."""
    s = db.get(models.Sparepart, sp_id)
    if not s:
        raise HTTPException(404, "Data tidak ditemukan")
    baru = (s.stok or 0) + int(body.delta or 0)
    if baru < 0:
        raise HTTPException(400, "Stok tidak boleh minus")
    s.stok = baru
    db.add(models.StockAdjustment(
        sparepart_id=s.id, nama_barang=s.nama or "", delta=int(body.delta or 0),
        stok_akhir=baru, alasan=(body.alasan or "").strip()[:255],
        oleh=(user.nama or "").strip(),
    ))
    db.commit()
    db.refresh(s)
    return to_out(s)


@router.get("/{sp_id}/stock-log")
def stock_log(sp_id: int, limit: int = 50,
              db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    """Riwayat perubahan stok manual untuk 1 barang (jejak audit)."""
    rows = (db.query(models.StockAdjustment)
            .filter(models.StockAdjustment.sparepart_id == sp_id)
            .order_by(models.StockAdjustment.id.desc())
            .limit(max(1, min(limit, 200))).all())
    return [{
        "id": r.id, "nama": r.nama_barang or "", "delta": r.delta or 0,
        "stok_akhir": r.stok_akhir or 0, "alasan": r.alasan or "",
        "oleh": r.oleh or "", "tanggal": r.created_at.isoformat() if r.created_at else "",
    } for r in rows]


@router.get("/template/excel")
def download_template_excel(__: models.User = Depends(require_admin)):
    wb = Workbook()
    ws = wb.active
    ws.title = "Produk"
    headers = ["SKU", "Nama Barang", "Merk", "Kategori", "Jenis(Sparepart/Accessories/Handphone)", "HPP", "Harga Jual", "Stok", "Stok Min"]
    ws.append(headers)
    ws.append(["CONTOH-001", "Contoh Barang", "Generic", "Lainnya", "Sparepart", 10000, 15000, 5, 2])
    ws["A1"].comment = __import__("openpyxl").comments.Comment("Wajib diisi & unik", "POS")
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    fn = f"template-import-produk-{datetime.now().strftime('%Y%m%d')}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fn}"'},
    )


@router.get("/template/csv")
def download_template_csv(__: models.User = Depends(require_admin)):
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["SKU", "Nama Barang", "Merk", "Kategori", "Jenis(Sparepart/Accessories/Handphone)", "HPP", "Harga Jual", "Stok", "Stok Min"])
    w.writerow(["CONTOH-001", "Contoh Barang", "Generic", "Lainnya", "Sparepart", 10000, 15000, 5, 2])
    out.seek(0)
    fn = f"template-import-produk-{datetime.now().strftime('%Y%m%d')}.csv"
    return StreamingResponse(
        iter([out.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{fn}"'},
    )


def _num(v):
    if v is None:
        return 0
    s = str(v).strip()
    if s == "":
        return 0
    s = s.replace(".", "").replace(",", ".") if "," in s and "." in s and s.rfind(",") > s.rfind(".") else s.replace(",", "")
    try:
        return int(float(s))
    except Exception:
        try:
            return int(s)
        except Exception:
            return 0


@router.post("/import")
def import_spareparts(file: UploadFile = File(...), db: Session = Depends(get_db), __: models.User = Depends(require_admin)):
    name = (file.filename or "").lower()
    content = file.file.read()
    rows = []
    if name.endswith(".xlsx") or name.endswith(".xlsm"):
        try:
            wb = load_workbook(io.BytesIO(content), data_only=True)
            ws = wb.active
            headers = []
            for c in ws[1]:
                headers.append(str(c.value or "").strip())
            hmap = {h.lower(): i for i, h in enumerate(headers)}
            for r in ws.iter_rows(min_row=2, values_only=True):
                if not r or all((x is None or str(x).strip() == "") for x in r):
                    continue
                def get(*keys):
                    for k in keys:
                        i = hmap.get(k.lower())
                        if i is not None and i < len(r):
                            return r[i]
                    return None
                rows.append({
                    "sku": get("sku"),
                    "nama": get("nama barang", "nama", "produk"),
                    "merk": get("merk"),
                    "kategori": get("kategori"),
                    "jenis": get("jenis(sparepart/accessories/handphone)", "jenis", "tipe"),
                    "hpp": get("hpp"),
                    "harga_jual": get("harga jual", "harga_jual", "jual", "harga"),
                    "stok": get("stok"),
                    "stok_min": get("stok min", "stok_min", "minimal", "min"),
                })
        except Exception as e:
            raise HTTPException(400, f"Gagal baca Excel: {e}")
    elif name.endswith(".csv") or name.endswith(".txt"):
        try:
            text = content.decode("utf-8-sig")
        except Exception:
            try:
                text = content.decode("latin-1")
            except Exception:
                text = content.decode("utf-8", errors="ignore")
        f = io.StringIO(text)
        reader = csv.DictReader(f)
        for row in reader:
            if not row or all((not (v or "").strip()) for v in row.values()):
                continue
            def g(*keys):
                for k in keys:
                    if k in row and row[k] not in (None, ""):
                        return row[k]
                    for kk, vv in row.items():
                        if kk and kk.strip().lower() == k.lower() and vv not in (None, ""):
                            return vv
                return None
            rows.append({
                "sku": g("SKU"),
                "nama": g("Nama Barang", "nama", "produk"),
                "merk": g("Merk"),
                "kategori": g("Kategori"),
                "jenis": g("Jenis(Sparepart/Accessories/Handphone)", "Jenis", "tipe"),
                "hpp": g("HPP"),
                "harga_jual": g("Harga Jual", "harga_jual", "jual", "harga"),
                "stok": g("Stok"),
                "stok_min": g("Stok Min", "stok_min", "minimal"),
            })
    else:
        raise HTTPException(400, "Format file harus .xlsx atau .csv")
    if not rows:
        raise HTTPException(400, "File kosong / tidak ada baris data")
    added = 0
    updated = 0
    skipped = 0
    errors = []
    for idx, r in enumerate(rows, start=2):
        try:
            sku = str(r.get("sku") or "").strip()
            nama = str(r.get("nama") or "").strip()
            if not sku or not nama:
                skipped += 1
                errors.append(f"Baris {idx}: SKU/Nama wajib diisi")
                continue
            s = db.query(models.Sparepart).filter(models.Sparepart.sku == sku).first()
            data = {
                "merk": (str(r.get("merk") or "").strip()),
                "kategori": _norm_kat(str(r.get("kategori") or "")),
                "jenis": _norm_jenis(str(r.get("jenis") or "")),
                "hpp": _num(r.get("hpp")),
                "harga_jual": _num(r.get("harga_jual")),
                "stok": _num(r.get("stok")),
                "stok_min": _num(r.get("stok_min")),
            }
            if s:
                s.nama = nama
                for k, v in data.items():
                    if v is not None:
                        setattr(s, k, v)
                updated += 1
            else:
                snew = models.Sparepart(nama=nama, sku=sku, **data)
                db.add(snew)
                added += 1
        except Exception as e:
            skipped += 1
            errors.append(f"Baris {idx}: {e}")
    db.commit()
    return {"ok": True, "added": added, "updated": updated, "skipped": skipped, "errors": errors[:20], "total": len(rows)}


@router.delete("/{sp_id}")
def delete_sparepart(sp_id: int, db: Session = Depends(get_db), __: models.User = Depends(require_admin)):
    s = db.get(models.Sparepart, sp_id)
    if not s:
        raise HTTPException(404, "Data tidak ditemukan")
    db.delete(s)
    db.commit()
    return {"ok": True}
