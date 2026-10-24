"""Penjualan Digital - sync dari Google Spreadsheet CSV publish."""
import csv
import io
from datetime import date, datetime
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models
from ..auth import get_current_user

router = APIRouter(prefix="/digital-sales", tags=["digital-sales"])

SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSHhhn_hKbTRmkQgt64mf5KN-sm9Jpw00v5cuXCEGI25lCvS0zBAZwDdb944Nt2AKnDkDr3WWlGF8oX/pub?gid=0&single=true&output=csv"


def _num(v) -> int:
    if v is None:
        return 0
    s = str(v).strip().replace("\u00a0", " ").replace("'", "")
    if s == "" or s.lower() == "none":
        return 0
    # Remove currency symbols
    import re
    s = re.sub(r'[^\d,.\-]', '', s)
    if s == "" or s == "-":
        return 0
    # Indonesian format: 19.965 or 23.000 (dot as thousand separator) or 3.035,00 (dot thousand, comma decimal)
    if "," in s and "." in s:
        # If comma is last, it's decimal separator (European/Indonesian)
        if s.rfind(",") > s.rfind("."):
            s2 = s.replace(".", "").replace(",", ".")
        else:
            s2 = s.replace(",", "")
    elif "," in s and "." not in s:
        # Could be decimal comma
        parts = s.split(",")
        if len(parts) == 2 and len(parts[1]) <= 2:
            s2 = s.replace(",", ".")
        else:
            s2 = s.replace(",", "")
    elif "." in s and "," not in s:
        parts = s.split(".")
        # If multiple dots or ends with 3 digits and looks like thousand sep
        if len(parts) > 2:
            s2 = s.replace(".", "")
        elif len(parts) == 2 and len(parts[1]) == 3:
            # Ambiguous - in Indonesian context often thousand sep
            # But be conservative: try as thousand sep first (common in this sheet)
            s2 = s.replace(".", "")
        elif len(parts) == 2 and len(parts[1]) == 2:
            s2 = s
        else:
            s2 = s.replace(".", "")
    else:
        s2 = s
    try:
        f = float(s2)
        if abs(f - round(f)) < 1e-9:
            return int(round(f))
        return int(round(f))
    except Exception:
        return 0


@router.get("/status")
def status(db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    total = db.query(models.DigitalSale).count()
    last = db.query(models.DigitalSale).order_by(models.DigitalSale.synced_at.desc()).first()
    return {
        "count": total,
        "last_sync": last.synced_at.isoformat() if last and last.synced_at else None,
        "sheet_url": SHEET_CSV_URL,
    }


@router.post("/sync")
async def sync(db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            resp = await client.get(SHEET_CSV_URL)
            resp.raise_for_status()
            text = resp.text
    except Exception as e:
        raise HTTPException(500, f"Gagal mengambil data spreadsheet: {e}")

    try:
        # Try to decode
        if isinstance(text, bytes):
            text = text.decode("utf-8-sig", errors="replace")
        else:
            # httpx gives str
            pass
    except Exception:
        pass

    f = io.StringIO(text)
    reader = csv.DictReader(f)
    added = 0
    skipped = 0
    today = date.today().isoformat()
    for row in reader:
        if not row:
            continue
        # Get nomor urut
        no_urut = None
        for k, v in row.items():
            if k and "nomor" in k.lower() and "urut" in k.lower():
                no_urut = str(v).strip() if v else None
                break
        if not no_urut:
            # try first column
            for k, v in row.items():
                if k:
                    no_urut = str(v).strip() if v else None
                    break
        if not no_urut or no_urut == "":
            skipped += 1
            continue
        # Check duplicate
        exists = db.query(models.DigitalSale).filter(models.DigitalSale.nomor_urut == no_urut).first()
        if exists:
            skipped += 1
            continue
        # Extract fields
        def get_field(*patterns):
            for k, v in row.items():
                if not k:
                    continue
                kl = k.lower().replace(" ", "").replace("_", "")
                for p in patterns:
                    pl = p.lower().replace(" ", "").replace("_", "")
                    if pl in kl or kl in pl:
                        return v
            return None

        kode = str(get_field("kode") or "").strip()
        no_tujuan = str(get_field("notujuan", "tujuan") or "").strip()
        hpp = _num(get_field("hpp"))
        harga_jual = _num(get_field("hargajual", "jual"))
        margin = _num(get_field("margin"))
        if margin == 0 and harga_jual >= 0 and hpp >= 0:
            margin = harga_jual - hpp

        ds = models.DigitalSale(
            nomor_urut=no_urut,
            kode=kode,
            no_tujuan=no_tujuan,
            hpp=hpp,
            harga_jual=harga_jual,
            margin=margin,
            tanggal=today,
        )
        db.add(ds)
        added += 1
    db.commit()
    return {"ok": True, "added": added, "skipped": skipped, "total_synced": added + skipped}


@router.get("")
def list_digital(
    q: str = Query("", description="cari kode / no tujuan / nomor urut"),
    dari: str = Query(""),
    sampai: str = Query(""),
    skip: int = 0,
    limit: int = 1000,
    db: Session = Depends(get_db),
    _: models.User = Depends(get_current_user),
):
    rows = db.query(models.DigitalSale).order_by(models.DigitalSale.id.desc()).all()
    if dari:
        rows = [r for r in rows if (r.tanggal or "") >= dari]
    if sampai:
        rows = [r for r in rows if (r.tanggal or "") <= sampai]
    if q:
        ql = q.lower()
        rows = [r for r in rows if ql in " ".join([r.nomor_urut or "", r.kode or "", r.no_tujuan or ""]).lower()]
    out = []
    for r in rows[skip : skip + limit]:
        out.append({
            "id": r.id,
            "nomor_urut": r.nomor_urut,
            "kode": r.kode,
            "no_tujuan": r.no_tujuan,
            "hpp": r.hpp or 0,
            "harga_jual": r.harga_jual or 0,
            "margin": r.margin or 0,
            "tanggal": r.tanggal or "",
            "synced_at": r.synced_at.isoformat() if r.synced_at else "",
        })
    return out
