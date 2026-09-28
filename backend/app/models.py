"""Tabel database: users, services, service_histories, settings."""
from datetime import datetime
from sqlalchemy import String, Integer, Text, DateTime, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    nama: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str | None] = mapped_column(String(160), unique=True, nullable=True, index=True)
    hp: Mapped[str | None] = mapped_column(String(30), unique=True, nullable=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), default="kasir", nullable=False)  # kasir|admin|superadmin
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Service(Base):
    __tablename__ = "services"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    no_service: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False)
    tanggal: Mapped[str] = mapped_column(String(20), default="")
    nama: Mapped[str] = mapped_column(String(120), nullable=False)
    telp: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    alamat: Mapped[str] = mapped_column(Text, default="")
    merk: Mapped[str] = mapped_column(String(80), nullable=False)
    tipe: Mapped[str] = mapped_column(String(80), nullable=False)
    # kolom legacy tetap ada agar data lama tidak rusak (frontend baru tidak mengisinya)
    warna: Mapped[str] = mapped_column(String(60), default="")
    imei: Mapped[str] = mapped_column(String(80), default="")
    sandi: Mapped[str] = mapped_column(String(120), default="")
    kelengkapan: Mapped[list] = mapped_column(JSON, default=list)
    keluhan: Mapped[str] = mapped_column(Text, nullable=False)
    kondisi: Mapped[str] = mapped_column(Text, default="")
    teknisi: Mapped[str] = mapped_column(String(80), default="")
    biaya: Mapped[int] = mapped_column(Integer, default=0)
    dp: Mapped[int] = mapped_column(Integer, default=0)
    estimasi: Mapped[str] = mapped_column(String(20), default="")
    catatan: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(30), default="Antri", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    histories: Mapped[list["ServiceHistory"]] = relationship(
        "ServiceHistory", back_populates="service", cascade="all, delete-orphan"
    )


class ServiceHistory(Base):
    __tablename__ = "service_histories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    service_id: Mapped[int] = mapped_column(ForeignKey("services.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    service: Mapped[Service] = relationship("Service", back_populates="histories")


class Setting(Base):
    __tablename__ = "settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    nama: Mapped[str] = mapped_column(String(160), default="ServisHP Pro - POS Konter")
    alamat: Mapped[str] = mapped_column(Text, default="Jl. Merdeka No. 1, Kota Anda")
    telp: Mapped[str] = mapped_column(String(60), default="08xx-xxxx-xxxx")
    nota: Mapped[str] = mapped_column(
        Text,
        default="Garansi 7 hari untuk service yang sama. Barang yang tidak diambil >30 hari bukan tanggung jawab kami.",
    )
    teknisi: Mapped[list] = mapped_column(JSON, default=lambda: ["Andi", "Budi"])
    merk: Mapped[list] = mapped_column(
        JSON, default=lambda: ["Samsung", "iPhone", "Xiaomi", "Oppo", "Vivo", "Realme", "Infinix"]
    )


class Slide(Base):
    __tablename__ = "slides"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    judul: Mapped[str] = mapped_column(String(160), default="")
    subjudul: Mapped[str] = mapped_column(Text, default="")
    image_url: Mapped[str] = mapped_column(Text, default="")
    link: Mapped[str] = mapped_column(String(255), default="")
    urutan: Mapped[int] = mapped_column(Integer, default=0)
    aktif: Mapped[int] = mapped_column(Integer, default=1)  # 1 tampil, 0 sembunyi
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Sparepart(Base):
    __tablename__ = "spareparts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    nama: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    sku: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    merk: Mapped[str] = mapped_column(String(80), default="")
    hpp: Mapped[int] = mapped_column(Integer, default=0)
    harga_jual: Mapped[int] = mapped_column(Integer, default=0)
    stok: Mapped[int] = mapped_column(Integer, default=0)
    stok_min: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
