"""Pydantic schemas (request/response)."""
from datetime import datetime
from pydantic import BaseModel, Field


# ---------- Auth ----------
class RegisterIn(BaseModel):
    nama: str = Field(min_length=1)
    email: str | None = None
    hp: str | None = None
    password: str = Field(min_length=6)
    role: str = "kasir"


class LoginIn(BaseModel):
    identifier: str = Field(min_length=1, description="email atau no HP")
    password: str = Field(min_length=1)
    remember: bool = True


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserOut"


class PasswordChangeIn(BaseModel):
    new_password: str = Field(min_length=6)
    confirm: str | None = None


# ---------- Users ----------
class UserOut(BaseModel):
    id: int
    nama: str
    email: str | None = None
    hp: str | None = None
    role: str
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class UserCreateIn(BaseModel):
    nama: str
    email: str | None = None
    hp: str | None = None
    password: str = Field(min_length=6)
    role: str = "kasir"


class RoleUpdateIn(BaseModel):
    role: str


class ResetPwIn(BaseModel):
    new_password: str = Field(min_length=6)


# ---------- Services ----------
class HistoryOut(BaseModel):
    status: str
    t: datetime | None = None

    model_config = {"from_attributes": False}


class ServiceIn(BaseModel):
    tanggal: str | None = None
    nama: str
    telp: str
    alamat: str | None = ""
    merk: str
    tipe: str
    warna: str | None = ""
    imei: str | None = ""
    sandi: str | None = ""
    kelengkapan: list[str] = []
    keluhan: str
    kondisi: str | None = ""
    teknisi: str | None = ""
    biaya: int = 0
    dp: int = 0
    estimasi: str | None = ""
    catatan: str | None = ""
    status: str = "Dikerjakan"


class ServiceUpdateIn(BaseModel):
    nama: str | None = None
    telp: str | None = None
    alamat: str | None = None
    merk: str | None = None
    tipe: str | None = None
    warna: str | None = None
    imei: str | None = None
    sandi: str | None = None
    kelengkapan: list[str] | None = None
    keluhan: str | None = None
    kondisi: str | None = None
    teknisi: str | None = None
    biaya: int | None = None
    dp: int | None = None
    estimasi: str | None = None
    catatan: str | None = None
    status: str | None = None


class StatusUpdateIn(BaseModel):
    status: str


class ServiceOut(BaseModel):
    id: int
    noService: str
    tanggal: str = ""
    nama: str
    telp: str
    alamat: str = ""
    merk: str
    tipe: str
    warna: str = ""
    imei: str = ""
    sandi: str = ""
    kelengkapan: list[str] = []
    keluhan: str
    kondisi: str = ""
    teknisi: str = ""
    biaya: int = 0
    dp: int = 0
    estimasi: str = ""
    catatan: str = ""
    status: str
    riwayat: list[dict] = []

    model_config = {"from_attributes": False}


# ---------- Slides ----------
class SlideIn(BaseModel):
    judul: str | None = ""
    subjudul: str | None = ""
    image_url: str | None = ""
    link: str | None = ""
    urutan: int | None = 0
    aktif: bool | None = True


class SlideOut(BaseModel):
    id: int
    judul: str = ""
    subjudul: str = ""
    image_url: str = ""
    link: str = ""
    urutan: int = 0
    aktif: bool = True

    model_config = {"from_attributes": False}


# ---------- Settings ----------
class SettingOut(BaseModel):
    nama: str
    alamat: str
    telp: str
    nota: str
    teknisi: list[str] = []
    merk: list[str] = []


class SettingUpdateIn(BaseModel):
    nama: str | None = None
    alamat: str | None = None
    telp: str | None = None
    nota: str | None = None


class NameIn(BaseModel):
    nama: str = Field(min_length=1)


# ---------- Spareparts ----------
class SparepartIn(BaseModel):
    nama: str
    sku: str
    merk: str | None = ""
    kategori: str | None = "Lainnya"
    hpp: int = 0
    harga_jual: int = 0
    stok: int = 0
    stok_min: int = 0


class SparepartUpdateIn(BaseModel):
    nama: str | None = None
    sku: str | None = None
    merk: str | None = None
    kategori: str | None = None
    hpp: int | None = None
    harga_jual: int | None = None
    stok: int | None = None
    stok_min: int | None = None


class StockAdjustIn(BaseModel):
    delta: int


class SparepartOut(BaseModel):
    id: int
    nama: str
    sku: str
    merk: str = ""
    kategori: str = "Lainnya"
    hpp: int = 0
    harga_jual: int = 0
    stok: int = 0
    stok_min: int = 0

    model_config = {"from_attributes": False}


# ---------- Penjualan barang (retail sparepart) ----------
class SaleItemIn(BaseModel):
    sparepart_id: int | None = None
    sku: str | None = None
    qty: int = 1


class SaleIn(BaseModel):
    tanggal: str | None = None
    pelanggan: str | None = ""
    telp: str | None = ""
    metode: str | None = "Tunai"
    catatan: str | None = ""
    items: list[SaleItemIn] = Field(min_length=1)


class SaleItemOut(BaseModel):
    sparepart_id: int | None = None
    sku: str = ""
    nama: str = ""
    hpp: int = 0
    harga: int = 0
    qty: int = 0
    subtotal: int = 0

    model_config = {"from_attributes": False}


class SaleOut(BaseModel):
    id: int
    no_nota: str
    tanggal: str = ""
    pelanggan: str = ""
    telp: str = ""
    total: int = 0
    hpp_total: int = 0
    laba: int = 0
    metode: str = "Tunai"
    catatan: str = ""
    kasir: str = ""
    items: list[SaleItemOut] = []

    model_config = {"from_attributes": False}


# ---------- Pengeluaran / Biaya ----------
class ExpenseIn(BaseModel):
    tanggal: str | None = None
    kategori: str | None = "Lainnya"
    keterangan: str | None = ""
    jumlah: int = Field(ge=0)


class ExpenseUpdateIn(BaseModel):
    tanggal: str | None = None
    kategori: str | None = None
    keterangan: str | None = None
    jumlah: int | None = Field(default=None, ge=0)


class ExpenseOut(BaseModel):
    id: int
    tanggal: str = ""
    kategori: str = "Lainnya"
    keterangan: str = ""
    jumlah: int = 0
    dicatat_oleh: str = ""

    model_config = {"from_attributes": False}


class ReportOut(BaseModel):
    dari: str = ""
    sampai: str = ""
    service_masuk: int = 0
    service_selesai: int = 0
    service_omzet: int = 0
    service_per_status: dict = {}
    service_diambil: list = []
    penjualan_count: int = 0
    penjualan_omzet: int = 0
    penjualan_hpp: int = 0
    penjualan_laba: int = 0
    expense_count: int = 0
    expense_total: int = 0
    total_pendapatan: int = 0
    total_laba: int = 0
    stok_item: int = 0
    stok_nilai_hpp: int = 0
    stok_nilai_jual: int = 0
    stok_menipis: int = 0

    model_config = {"from_attributes": False}


# ---------- AI Router / Monitor ----------
class AiProviderIn(BaseModel):
    name: str = Field(min_length=1)
    kind: str = "openai"
    base_url: str = ""
    api_key: str = ""
    model: str = ""
    price_prompt_per_1k: float = 0.0
    price_completion_per_1k: float = 0.0
    priority: int = 1
    is_active: bool = True


class AiProviderOut(BaseModel):
    id: int
    name: str
    kind: str = ""
    base_url: str = ""
    api_key_masked: str = ""
    model: str = ""
    price_prompt_per_1k: float = 0.0
    price_completion_per_1k: float = 0.0
    priority: int = 1
    is_active: bool = True
    status: str = "idle"
    last_latency_ms: int = 0
    last_error: str = ""
    last_check_at: datetime | None = None

    model_config = {"from_attributes": False}


class AiClientIn(BaseModel):
    name: str = Field(min_length=1)
    rate_limit_per_min: int = 60
    is_active: bool = True


class AiClientOut(BaseModel):
    id: int
    name: str
    api_key: str = ""
    api_key_masked: str = ""
    rate_limit_per_min: int = 60
    is_active: bool = True
    total_requests: int = 0
    total_tokens: int = 0
    last_used_at: datetime | None = None

    model_config = {"from_attributes": False}


class AiChatMessage(BaseModel):
    role: str = "user"
    content: str = ""


class AiChatIn(BaseModel):
    messages: list[AiChatMessage] = Field(min_length=1)
    model: str = ""
    provider: str = ""  # nama provider spesifik, kosong = auto by priority
    max_tokens: int = 512
    temperature: float = 0.7
