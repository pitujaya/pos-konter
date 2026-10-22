"""CRUD /api/slides + upload gambar headbar."""
import uuid
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas
from ..auth import get_current_user, require_admin
from ..paths import UPLOAD_DIR

router = APIRouter(prefix="/slides", tags=["slides"])
ALLOWED = {"image/jpeg", "image/png", "image/webp", "image/gif"}
SAFE_LINK_SCHEMES = ("http://", "https://", "/", "#", "mailto:", "tel:")


def safe_link(raw: str | None) -> str:
    """Bersihkan URL tautan slide.

    Nilai ini nanti dipakai sebagai href di halaman dashboard. Skema seperti
    javascript: / data: bisa menjalankan skrip di origin aplikasi (XSS), jadi
    hanya skema aman yang boleh lewat. Kalau tidak aman -> dikosongkan.
    """
    v = (raw or "").strip()
    if not v:
        return ""
    low = v.lower()
    if low.startswith(SAFE_LINK_SCHEMES):
        return v
    # skema relatif tanpa "//" (mis. "halaman/detail") juga aman
    if not low.startswith(("javascript:", "data:", "vbscript:", "file:")) and ":" not in v.split("/")[0]:
        return v
    return ""


def to_out(s: models.Slide) -> dict:
    return {
        "id": s.id, "judul": s.judul or "", "subjudul": s.subjudul or "",
        "image_url": s.image_url or "", "link": s.link or "",
        "urutan": s.urutan or 0, "aktif": bool(s.aktif),
    }


@router.get("", response_model=list[schemas.SlideOut])
def list_active(db: Session = Depends(get_db), _: models.User = Depends(get_current_user)):
    rows = db.query(models.Slide).filter(models.Slide.aktif == 1).order_by(models.Slide.urutan.asc(), models.Slide.id.asc()).all()
    return [to_out(r) for r in rows]


@router.get("/all", response_model=list[schemas.SlideOut])
def list_all(db: Session = Depends(get_db), __: models.User = Depends(require_admin)):
    rows = db.query(models.Slide).order_by(models.Slide.urutan.asc(), models.Slide.id.asc()).all()
    return [to_out(r) for r in rows]


@router.post("", response_model=schemas.SlideOut, status_code=201)
def create_slide(body: schemas.SlideIn, db: Session = Depends(get_db), __: models.User = Depends(require_admin)):
    s = models.Slide(
        judul=(body.judul or "").strip(), subjudul=(body.subjudul or "").strip(),
        image_url=(body.image_url or "").strip(), link=safe_link(body.link),
        urutan=int(body.urutan or 0), aktif=1 if body.aktif else 0,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return to_out(s)


@router.put("/{slide_id}", response_model=schemas.SlideOut)
def update_slide(slide_id: int, body: schemas.SlideIn, db: Session = Depends(get_db), __: models.User = Depends(require_admin)):
    s = db.get(models.Slide, slide_id)
    if not s:
        raise HTTPException(404, "Slide tidak ditemukan")
    if body.judul is not None:
        s.judul = body.judul
    if body.subjudul is not None:
        s.subjudul = body.subjudul
    if body.image_url is not None:
        s.image_url = body.image_url
    if body.link is not None:
        s.link = safe_link(body.link)
    if body.urutan is not None:
        s.urutan = int(body.urutan)
    if body.aktif is not None:
        s.aktif = 1 if body.aktif else 0
    db.commit()
    db.refresh(s)
    return to_out(s)


@router.delete("/{slide_id}")
def delete_slide(slide_id: int, db: Session = Depends(get_db), __: models.User = Depends(require_admin)):
    s = db.get(models.Slide, slide_id)
    if not s:
        raise HTTPException(404, "Slide tidak ditemukan")
    # hapus file lokal kalau hasil upload sendiri
    try:
        if (s.image_url or "").startswith("/static/uploads/"):
            f = UPLOAD_DIR / Path(s.image_url).name
            if f.exists():
                f.unlink()
    except Exception:
        pass
    db.delete(s)
    db.commit()
    return {"ok": True}


@router.post("/upload")
def upload_image(file: UploadFile = File(...), __: models.User = Depends(require_admin)):
    if file.content_type not in ALLOWED:
        raise HTTPException(400, "File harus gambar (jpg/png/webp/gif)")
    data = file.file.read()
    if len(data) > 3 * 1024 * 1024:
        raise HTTPException(400, "Maksimal 3MB")
    ext = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}[file.content_type]
    name = f"slide-{uuid.uuid4().hex[:12]}{ext}"
    (UPLOAD_DIR / name).write_bytes(data)
    return {"url": f"/static/uploads/{name}"}
