"""Penjualan Digital - sync dari Google Spreadsheet."""
import csv
import io
import random
import time
from datetime import date, datetime
from typing import Optional

try:
    import httpx  # type: ignore
except Exception:
    httpx = None
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models
from ..auth import get_current_user

router = APIRouter(prefix="/digital-sales", tags=["digital-sales"])

# Prefer direct export from original sheet (faster update)
SHEET_ID = "1tweMQmM0YKnqHL1SPH_GtU1PV2pRvUVqUz-f9S6Ip6o"
SHEET_GID = "0"
SHEET_CSV_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={SHEET_GID}"
# Fallback
SHEET_CSV_URL_PUB = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSHhhn_hKbTRmkQgt64mf5KN-sm9Jpw00v5cuXCEGI25lCvS0zBAZwDdb944Nt2AKnDkDr3WWlGF8oX/pub?gid=0&single=true&output=csv"


def _fetch_csv():
    bust = int(time.time() * 1000) + random.randint(1, 9999)
    headers = {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    }
    urls = [
        f"{SHEET_CSV_URL}&t={bust}&r={random.randint(100000,999999)}",
        f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv&gid={SHEET_GID}&t={bust}",
        f"{SHEET_CSV_URL_PUB}&t={bust}&cb={bust}",
    ]
    last_err = None
    for url in urls:
        try:
            if httpx is not None:
                try:
                    with httpx.Client(timeout=30.0, follow_redirects=True, headers=headers) as client:
                        resp = client.get(url)
                        resp.raise_for_status()
                        txt = resp.text
                        if txt and not txt.strip().startswith("<!DOCTYPE"):
                            return txt
                        raise Exception("HTML response")
                except Exception as e:
                    last_err = e
                    continue
            req = Request(url, headers=headers)
            try:
                with urlopen(req, timeout=30) as resp:
                    data = resp.read()
                try:
                    txt = data.decode("utf-8-sig")
                except Exception:
                    txt = data.decode("utf-8", errors="replace")
                if txt and txt.strip().startswith("<!DOCTYPE"):
                    raise Exception("HTML response")
                return txt
            except Exception as e:
                last_err = e
                continue
        except Exception as e:
            last_err = e
            continue
    if last_err:
        raise Exception(str(last_err))
    raise Exception("Gagal mengambil CSV")


def _num(v) -> int:
    if v is None:
        return 0
    s = str(v).strip().replace("\u00a0", " ").replace("'", "")
    if s == "" or s.lower() == "none":
        return 0
    import re
    s = re.sub(r'[^\d,.\-]', '', s)
    if s == "" or s == "-" or s == "," or s == ".":
        return 0
    # Indonesian format: 1.645.800 (dots = thousand sep) or 3.035,00 (dots thousand, comma decimal)
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s2 = s.replace(".", "").replace(",", ".")
        else:
            s2 = s.replace(",", "")
    elif "," in s and "." not in s:
        parts = s.split(",")
        if len(parts) == 2 and len(parts[1]) <= 2:
            s2 = s.replace(",", ".")
        else:
            # multiple commas unlikely, treat as thousand
            s2 = s.replace(",", "")
    elif "." in s and "," not in s:
        parts = s.split(".")
        if len(parts) > 2:
            # all dots = thousand separators
            s2 = "".join(parts)
        elif len(parts) == 2 and len(parts[1]) == 3:
            # Could be thousand sep (19.965) or decimal - in this sheet thousand sep
            s2 = "".join(parts)
        elif len(parts) == 2 and len(parts[1]) == 2:
            s2 = s
        else:
            s2 = s.replace(".", "")
    else:
        s2 = s
    try:
        # Remove any remaining non-digit except sign and dot
        s2 = re.sub(r'[^\d\.\-]', '', s2)
        f = float(s2)
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
def sync(db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    try:
        text = _fetch_csv()
    except Exception as e:
        raise HTTPException(500, f"Gagal mengambil data spreadsheet: {e}")
    # Sync dari CSV harus jadi sumber kebenaran: hapus yang tidak ada di sheet lagi
    # (biar nomor urut & jumlah nyambung persis)

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
    updated = 0
    skipped = 0
    removed = 0
    today = date.today().isoformat()
    seen = set()
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
        seen.add(str(no_urut))
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

        exists = db.query(models.DigitalSale).filter(models.DigitalSale.nomor_urut == str(no_urut)).first()
        if exists:
            # Selalu update biar realtime
            exists.kode = kode
            exists.no_tujuan = no_tujuan
            exists.hpp = hpp
            exists.harga_jual = harga_jual
            exists.margin = margin if margin != 0 or (harga_jual >= 0 and hpp >= 0) else (harga_jual - hpp)
            exists.tanggal = today
            exists.updated_at = datetime.utcnow()
            updated += 1
            continue
        ds = models.DigitalSale(
            nomor_urut=str(no_urut),
            kode=kode,
            no_tujuan=no_tujuan,
            hpp=hpp,
            harga_jual=harga_jual,
            margin=margin,
            tanggal=today,
        )
        db.add(ds)
        added += 1
    # Hapus baris yang sudah tidak ada di sheet
    try:
        for r in db.query(models.DigitalSale).all():
            if str(r.nomor_urut) not in seen:
                db.delete(r)
                removed += 1
    except Exception:
        pass
    db.commit()
    db.expire_all()
    return {"ok": True, "added": added, "updated": updated, "removed": removed, "skipped": skipped, "total_synced": added + updated + skipped}


@router.get("/raw")
def raw_csv(_: models.User = Depends(get_current_user)):
    try:
        text = _fetch_csv()
        return {"ok": True, "text": text, "count": len(text.splitlines())}
    except Exception as e:
        raise HTTPException(500, f"Gagal: {e}")


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
