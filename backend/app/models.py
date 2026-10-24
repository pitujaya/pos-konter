"""Tabel database: users, services, service_histories, settings."""
from datetime import datetime
from sqlalchemy import String, Integer, Float, Text, DateTime, ForeignKey, JSON
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
    status: Mapped[str] = mapped_column(String(30), default="Dikerjakan", index=True)
    kasir: Mapped[str] = mapped_column(String(120), default="", index=True)
    # Cara bayar service saat diambil (tunai/non-tunai) -> menentukan kas fisik.
    metode_bayar: Mapped[str] = mapped_column(String(30), default="tunai")
    # Jejak notifikasi WhatsApp yang sudah dikirim ke pelanggan.
    wa_terkirim_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    wa_terkirim_oleh: Mapped[str] = mapped_column(String(120), default="")
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
    # Hak akses per role yang diatur Super Admin. Disimpan sebagai override:
    # key yang tidak ada berarti izinkan (default lama tetap sama).
    akses: Mapped[dict] = mapped_column(JSON, default=dict)


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
    kategori: Mapped[str] = mapped_column(String(80), default="Lainnya", index=True)
    jenis: Mapped[str] = mapped_column(String(40), default="Sparepart", index=True)
    hpp: Mapped[int] = mapped_column(Integer, default=0)
    harga_jual: Mapped[int] = mapped_column(Integer, default=0)
    stok: Mapped[int] = mapped_column(Integer, default=0)
    stok_min: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class StockAdjustment(Base):
    """Jejak audit perubahan stok manual.

    Tanpa log ini, siapa pun yang bisa ubah stok bisa menaikkan stok bebas
    tanpa meninggalkan jejak, dan selisih stok vs fisik tidak bisa ditelusuri.
    """

    __tablename__ = "stock_adjustments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sparepart_id: Mapped[int | None] = mapped_column(
        ForeignKey("spareparts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    nama_barang: Mapped[str] = mapped_column(String(160), default="")
    delta: Mapped[int] = mapped_column(Integer, default=0)
    stok_akhir: Mapped[int] = mapped_column(Integer, default=0)
    alasan: Mapped[str] = mapped_column(String(255), default="")
    oleh: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class Sale(Base):
    """Penjualan barang/sparepart langsung (tanpa service). Stok otomatis berkurang."""

    __tablename__ = "sales"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    no_nota: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False)
    tanggal: Mapped[str] = mapped_column(String(20), default="", index=True)
    pelanggan: Mapped[str] = mapped_column(String(120), default="")
    telp: Mapped[str] = mapped_column(String(30), default="")
    subtotal: Mapped[int] = mapped_column(Integer, default=0)
    diskon: Mapped[int] = mapped_column(Integer, default=0)
    diskon_persen: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer, default=0)
    hpp_total: Mapped[int] = mapped_column(Integer, default=0)
    laba: Mapped[int] = mapped_column(Integer, default=0)
    metode: Mapped[str] = mapped_column(String(30), default="Tunai")
    catatan: Mapped[str] = mapped_column(Text, default="")
    kasir: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    items: Mapped[list["SaleItem"]] = relationship(
        "SaleItem", back_populates="sale", cascade="all, delete-orphan"
    )


class SaleItem(Base):
    __tablename__ = "sale_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sale_id: Mapped[int] = mapped_column(ForeignKey("sales.id", ondelete="CASCADE"), index=True)
    sparepart_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sku: Mapped[str] = mapped_column(String(80), default="")
    nama: Mapped[str] = mapped_column(String(160), default="")
    hpp: Mapped[int] = mapped_column(Integer, default=0)
    harga: Mapped[int] = mapped_column(Integer, default=0)
    qty: Mapped[int] = mapped_column(Integer, default=1)
    subtotal: Mapped[int] = mapped_column(Integer, default=0)

    sale: Mapped[Sale] = relationship("Sale", back_populates="items")


class Expense(Base):
    """Biaya operasional (mengurangi laba) atau pendapatan lain (menambah laba)."""

    __tablename__ = "expenses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tanggal: Mapped[str] = mapped_column(String(20), default="", index=True)
    jenis: Mapped[str] = mapped_column(String(20), default="biaya", index=True)
    kategori: Mapped[str] = mapped_column(String(80), default="Lainnya", index=True)
    keterangan: Mapped[str] = mapped_column(Text, default="")
    jumlah: Mapped[int] = mapped_column(Integer, default=0)
    dicatat_oleh: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class DigitalSale(Base):
    """Penjualan digital yang disinkron dari Google Spreadsheet (CSV publish)."""

    __tablename__ = "digital_sales"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    nomor_urut: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    kode: Mapped[str] = mapped_column(String(80), default="", index=True)
    no_tujuan: Mapped[str] = mapped_column(String(80), default="")
    hpp: Mapped[int] = mapped_column(Integer, default=0)
    harga_jual: Mapped[int] = mapped_column(Integer, default=0)
    margin: Mapped[int] = mapped_column(Integer, default=0)
    tanggal: Mapped[str] = mapped_column(String(20), default="", index=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class CashSession(Base):
    """Sesi buka/tutup kasir (shift). Satu sesi terbuka per kasir.

    Rekap dihitung saat sesi ditutup: penjualan (tunai/non-tunai), pengeluaran,
    dan omzet service yang diambil dalam rentang waktu sesi.
    """

    __tablename__ = "cash_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    kasir: Mapped[str] = mapped_column(String(120), default="", index=True)
    status: Mapped[str] = mapped_column(String(10), default="open", index=True)  # open|closed
    modal_awal: Mapped[int] = mapped_column(Integer, default=0)
    opened_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # rekap transaksi dalam sesi
    jml_transaksi: Mapped[int] = mapped_column(Integer, default=0)
    penjualan_count: Mapped[int] = mapped_column(Integer, default=0)
    penjualan_total: Mapped[int] = mapped_column(Integer, default=0)
    tunai_masuk: Mapped[int] = mapped_column(Integer, default=0)
    non_tunai: Mapped[int] = mapped_column(Integer, default=0)
    pengeluaran_total: Mapped[int] = mapped_column(Integer, default=0)
    service_count: Mapped[int] = mapped_column(Integer, default=0)
    service_omzet: Mapped[int] = mapped_column(Integer, default=0)
    service_tunai: Mapped[int] = mapped_column(Integer, default=0)
    # hasil hitung kas
    kas_sistem: Mapped[int] = mapped_column(Integer, default=0)  # modal awal + tunai (+kas service) - pengeluaran
    kas_akhir: Mapped[int] = mapped_column(Integer, default=0)   # hitungan fisik
    selisih: Mapped[int] = mapped_column(Integer, default=0)
    catatan: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AiProvider(Base):
    """Provider LLM untuk AI Router (gemini, ollama, nvidia, kiro, custom)."""
    __tablename__ = "ai_providers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(30), default="openai")  # gemini|openai|ollama|custom
    base_url: Mapped[str] = mapped_column(String(255), default="")
    api_key: Mapped[str] = mapped_column(String(255), default="")
    model: Mapped[str] = mapped_column(String(120), default="")
    price_prompt_per_1k: Mapped[float] = mapped_column(default=0.0)
    price_completion_per_1k: Mapped[float] = mapped_column(default=0.0)
    priority: Mapped[int] = mapped_column(Integer, default=1)
    is_active: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(20), default="idle")  # idle|live|error|offline
    last_latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str] = mapped_column(Text, default="")
    last_check_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AiClient(Base):
    """API key klien yang memakai router (Default Key, Opencode, kasir, dll)."""
    __tablename__ = "ai_clients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    api_key: Mapped[str] = mapped_column(String(120), unique=True, index=True, nullable=False)
    rate_limit_per_min: Mapped[int] = mapped_column(Integer, default=60)
    is_active: Mapped[int] = mapped_column(Integer, default=1)
    total_requests: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AiRequestLog(Base):
    __tablename__ = "ai_request_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    client_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    client_name: Mapped[str] = mapped_column(String(80), default="")
    provider_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    provider_name: Mapped[str] = mapped_column(String(80), default="")
    model: Mapped[str] = mapped_column(String(120), default="")
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(default=0.0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(10), default="ok", index=True)  # ok|error
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class Lead(Base):
    __tablename__ = "leads"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    nama: Mapped[str] = mapped_column(String(120), nullable=False)
    hp: Mapped[str] = mapped_column(String(30), index=True, nullable=False)
    konter: Mapped[str] = mapped_column(String(160), default="")
    email: Mapped[str] = mapped_column(String(160), default="")
    pesan: Mapped[str] = mapped_column(Text, default="")
    sumber: Mapped[str] = mapped_column(String(40), default="landing", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
