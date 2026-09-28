"""Seed awal: 3 akun demo + setting + 2 contoh service."""
from datetime import datetime
from sqlalchemy.orm import Session
from . import models
from .auth import hash_password, norm_email, norm_phone


def seed(db: Session):
    # --- users demo ---
    if db.query(models.User).count() == 0:
        demo = [
            ("Super Admin", "admin@konter.id", "081234567890", "admin123", "superadmin"),
            ("Admin Toko", "admin.toko@konter.id", "081234567891", "admin123", "admin"),
            ("Kasir Toko", "kasir.toko@konter.id", "081234567892", "kasir123", "kasir"),
        ]
        for nama, email, hp, pw, role in demo:
            db.add(models.User(nama=nama, email=norm_email(email), hp=norm_phone(hp),
                               password_hash=hash_password(pw), role=role))
        db.commit()

    # --- settings ---
    if not db.get(models.Setting, 1):
        db.add(models.Setting(id=1))
        db.commit()

    # --- headbar slide contoh ---
    if db.query(models.Slide).count() == 0:
        db.add_all([
            models.Slide(judul="Servis HP Cepat & Bergaransi", subjudul="LCD • Baterai • Software — estimasi jelas, nota otomatis", image_url="", link="", urutan=0, aktif=1),
            models.Slide(judul="Promo Ganti LCD Hari Ini", subjudul="Gratis tempered glass untuk 10 pelanggan pertama", image_url="", link="", urutan=1, aktif=1),
        ])
        db.commit()
    # --- contoh sparepart ---
    if db.query(models.Sparepart).count() == 0:
        db.add_all([
            models.Sparepart(nama="LCD Samsung A12", sku="LCD-SSA12", merk="Samsung", hpp=180000, harga_jual=250000, stok=8, stok_min=3),
            models.Sparepart(nama="Baterai Redmi 12C", sku="BAT-R12C", merk="Xiaomi", hpp=65000, harga_jual=95000, stok=2, stok_min=5),
            models.Sparepart(nama="Charger 25W USB-C", sku="CHR-25WC", merk="Samsung", hpp=45000, harga_jual=75000, stok=15, stok_min=5),
        ])
        db.commit()
    # --- contoh service ---
    if db.query(models.Service).count() == 0:
        today = datetime.now().date().isoformat()
        s1 = models.Service(
            no_service=f"SVC-{datetime.now().year}-0001", tanggal=today,
            nama="Budi Santoso", telp="08123456789", alamat="Jl. Melati No.5",
            merk="Samsung", tipe="Galaxy A12", sandi="1234",
            kelengkapan=["HP Saja", "Charger"], keluhan="LCD pecah, sentuh sebagian tidak respon",
            kondisi="Lecet pemakaian", teknisi="Andi", biaya=350000, dp=0,
            estimasi=today, catatan="Ganti LCD original", status="Dikerjakan",
        )
        s2 = models.Service(
            no_service=f"SVC-{datetime.now().year}-0002", tanggal=today,
            nama="Siti Aminah", telp="08234567890", alamat="Jl. Kenanga No.3",
            merk="Xiaomi", tipe="Redmi 12C", sandi="-",
            kelengkapan=["HP Saja"], keluhan="Baterai ngedrop, cepat panas",
            kondisi="Mulus", teknisi="Budi", biaya=150000, dp=0,
            estimasi=today, catatan="", status="Antri",
        )
        db.add_all([s1, s2])
        db.flush()
        db.add_all([
            models.ServiceHistory(service_id=s1.id, status="Antri"),
            models.ServiceHistory(service_id=s1.id, status="Dikerjakan"),
            models.ServiceHistory(service_id=s2.id, status="Antri"),
        ])
        db.commit()
