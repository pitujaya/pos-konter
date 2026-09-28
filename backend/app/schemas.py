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
    status: str = "Antri"


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
    hpp: int = 0
    harga_jual: int = 0
    stok: int = 0
    stok_min: int = 0


class SparepartUpdateIn(BaseModel):
    nama: str | None = None
    sku: str | None = None
    merk: str | None = None
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
    hpp: int = 0
    harga_jual: int = 0
    stok: int = 0
    stok_min: int = 0

    model_config = {"from_attributes": False}
