"""POST /api/leads - pendaftaran minat publik dari landing page."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models, schemas
from ..auth import norm_email, norm_phone, require_admin

router = APIRouter(tags=["leads"])


@router.post("/leads", status_code=201)
def create_lead(body: schemas.LeadIn, db: Session = Depends(get_db)):
    # Honeypot: bot mengisi field tersembunyi, balas sukses palsu.
    if (body.website or "").strip():
        return {"ok": True}

    nama = (body.nama or "").strip()
    hp = norm_phone(body.hp)
    if not nama:
        raise HTTPException(400, "Nama wajib diisi")
    if not hp or len(hp) < 9 or len(hp) > 15:
        raise HTTPException(400, "Nomor WhatsApp tidak valid")

    email = norm_email(body.email)
    if email and "@" not in email:
        raise HTTPException(400, "Format email tidak valid")

    lead = models.Lead(
        nama=nama[:120],
        hp=hp,
        konter=(body.konter or "").strip()[:160],
        email=email[:160],
        pesan=(body.pesan or "").strip()[:1000],
        sumber="landing",
    )
    db.add(lead)
    db.commit()
    db.refresh(lead)
    return {"ok": True, "id": lead.id}


@router.get("/leads", response_model=list[schemas.LeadOut])
def list_leads(db: Session = Depends(get_db), _: models.User = Depends(require_admin)):
    return db.query(models.Lead).order_by(models.Lead.id.desc()).all()
