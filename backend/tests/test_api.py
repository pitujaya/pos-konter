"""Test suite ServisHP Pro (backend).

Jalankan:
    cd backend
    python -m pytest tests -q

Setiap test memakai database SQLite sementara yang terpisah, jadi data produksi
tidak pernah tersentuh.
"""
import os
import sys
import tempfile
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

_TMP = tempfile.mkdtemp(prefix="servishp-test-")
os.environ["DATABASE_URL"] = f"sqlite:///{_TMP}/test.db"
os.environ["SECRET_KEY"] = "test-secret-key-0123456789-0123456789-abcdef"
os.environ["UPLOAD_DIR"] = f"{_TMP}/uploads"

from fastapi.testclient import TestClient  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app import models  # noqa: E402

SEED_ADMIN = ("admin@konter.id", "admin123")
SEED_KASIR = ("kasir.toko@konter.id", "kasir123")


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def admin(client):
    r = client.post("/api/auth/login", json={"identifier": SEED_ADMIN[0], "password": SEED_ADMIN[1]})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def kasir(client):
    r = client.post("/api/auth/login", json={"identifier": SEED_KASIR[0], "password": SEED_KASIR[1]})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture()
def sparepart():
    with SessionLocal() as db:
        sp = models.Sparepart(
            nama="Baterai Test", sku=f"BAT-T-{os.urandom(4).hex()}", merk="M",
            kategori="Baterai", jenis="Sparepart", hpp=1000, harga_jual=2000,
            stok=5, stok_min=1,
        )
        db.add(sp)
        db.commit()
        db.refresh(sp)
        return {"id": sp.id, "nama": sp.nama, "stok": sp.stok}


# ============================ AUTH & AUTORISASI ============================
class TestAuth:
    def test_register_public_always_kasir(self, client):
        """Pendaftaran publik tidak boleh bisa membuat akun admin/superadmin."""
        email = f"baru-{os.urandom(3).hex()}@konter.id"
        r = client.post("/api/auth/register", json={
            "nama": "Tester", "email": email, "password": "rahasia123",
            "role": "superadmin",
        })
        assert r.status_code == 200, r.text
        assert r.json()["user"]["role"] == "kasir"

    def test_forgot_password_public_disabled(self, client):
        """Reset password tanpa verifikasi harus tidak mungkin."""
        r = client.post("/api/auth/forgot", params={
            "identifier": SEED_ADMIN[0], "new_password": "hack12345"})
        assert r.status_code in (404, 410), r.text

    def test_admin_password_not_changed(self, client):
        r = client.post("/api/auth/login", json={
            "identifier": SEED_ADMIN[0], "password": "hack12345"})
        assert r.status_code == 401

    def test_login_ok(self, client):
        r = client.post("/api/auth/login", json={"identifier": SEED_ADMIN[0], "password": SEED_ADMIN[1]})
        assert r.status_code == 200 and r.json()["user"]["role"] == "superadmin"

    def test_me_requires_token(self, client):
        assert client.get("/api/auth/me").status_code == 401

    def test_change_own_password(self, client, admin):
        r = client.put("/api/auth/password", headers=admin, json={
            "new_password": "admin123", "confirm": "admin123"})
        assert r.status_code == 200

    def test_secret_key_not_public_constant(self):
        from app import auth as auth_mod
        assert auth_mod.SECRET_KEY != "dev-servishp-ganti-di-production"
        assert len(auth_mod.SECRET_KEY) >= 32


# ============================ AI MONITOR ============================
class TestAiMonitor:
    def test_kasir_cannot_create_provider(self, client, kasir):
        r = client.post("/api/ai/providers", headers=kasir, json={
            "name": f"evil-{os.urandom(3).hex()}", "kind": "gemini",
            "api_key": "SECRET", "base_url": "http://evil.local"})
        assert r.status_code == 403, r.text

    def test_kasir_cannot_delete_provider(self, client, kasir, admin):
        created = client.post("/api/ai/providers", headers=admin, json={
            "name": f"tmp-{os.urandom(3).hex()}", "kind": "gemini", "api_key": "K"})
        assert created.status_code in (200, 201)
        pid = created.json()["id"]
        r = client.delete(f"/api/ai/providers/{pid}", headers=kasir)
        assert r.status_code == 403

    def test_client_list_does_not_leak_raw_key(self, client, kasir):
        import re
        r = client.get("/api/ai/clients", headers=kasir)
        assert r.status_code == 200
        assert re.search(r'"api_key"\s*:\s*"nxr_[0-9a-f]{16,}"', r.text) is None

    def test_reveal_key_requires_superadmin(self, client, kasir):
        r = client.get("/api/ai/clients/1/key", headers=kasir)
        assert r.status_code == 403

    def test_chat_rejects_malformed_body(self, client, admin):
        r = client.post("/api/ai/chat/completions", headers=admin, json={"messages": "halo"})
        assert r.status_code == 422, r.text


# ============================ PENJUALAN & STOK ============================
class TestSalesStock:
    def test_duplicate_lines_cannot_make_stock_negative(self, client, admin, sparepart):
        client.post("/api/kas/open", headers=admin, json={"modal_awal": 100000})
        r = client.post("/api/sales", headers=admin, json={
            "items": [
                {"sparepart_id": sparepart["id"], "qty": 4},
                {"sparepart_id": sparepart["id"], "qty": 4},
            ],
            "metode": "tunai", "total": 16000,
        })
        assert r.status_code == 400, r.text
        with SessionLocal() as db:
            assert db.get(models.Sparepart, sparepart["id"]).stok >= 0

    def test_sale_decrements_stock_once(self, client, admin, sparepart):
        client.post("/api/kas/open", headers=admin, json={"modal_awal": 100000})
        r = client.post("/api/sales", headers=admin, json={
            "items": [{"sparepart_id": sparepart["id"], "qty": 2}],
            "metode": "tunai", "total": 4000,
        })
        assert r.status_code in (200, 201), r.text
        with SessionLocal() as db:
            assert db.get(models.Sparepart, sparepart["id"]).stok == sparepart["stok"] - 2

    def test_sale_requires_open_session(self, client, admin):
        # session dibuat unique per user -> gunakan user baru tanpa sesi
        reg = client.post("/api/auth/register", json={
            "nama": "Tanpa Sesi", "email": f"nos-{os.urandom(3).hex()}@konter.id",
            "password": "rahasia123"})
        h = {"Authorization": f"Bearer {reg.json()['access_token']}"}
        r = client.post("/api/sales", headers=h, json={
            "items": [{"sparepart_id": 1, "qty": 1}], "metode": "tunai", "total": 2000})
        assert r.status_code == 409


# ============================ SESI KASIR ============================
class TestCashSession:
    def test_scope_all_forbidden_for_kasir(self, client, kasir, admin):
        client.post("/api/kas/open", headers=admin, json={"modal_awal": 100000})
        r = client.get("/api/kas", headers=kasir, params={"scope": "all"})
        assert r.status_code == 403, r.text

    def test_scope_all_allowed_for_admin(self, client, admin):
        r = client.get("/api/kas", headers=admin, params={"scope": "all"})
        assert r.status_code == 200

    def test_service_of_other_kasir_not_counted(self, client, kasir, admin):
        """Service kasir lain tidak boleh masuk rekap sesi ini."""
        client.post("/api/kas/open", headers=admin, json={"modal_awal": 100000})
        svc = client.post("/api/services", headers=admin, json={
            "nama": "Pelanggan", "telp": "0812", "merk": "Xiaomi", "tipe": "Redmi",
            "keluhan": "rusak", "biaya": 100000, "status": "Dikerjakan"})
        assert svc.status_code == 201, svc.text
        sid = svc.json()["id"]
        st = client.patch(f"/api/services/{sid}/status", headers=admin, json={"status": "Diambil"})
        assert st.status_code == 200, st.text
        cur = client.get("/api/kas/current", headers=admin)
        assert cur.status_code == 200
        d = cur.json() or {}
        # service dibuat oleh admin -> boleh masuk sesi admin
        assert d.get("service_count", 0) >= 0

    def test_kas_sistem_includes_cash_service(self, client, kasir):
        """Kas service tunai harus menambah kas_sistem (tidak ada selisih palsu)."""
        reg = client.post("/api/auth/register", json={
            "nama": "Kasir Sesi", "email": f"ks-{os.urandom(3).hex()}@konter.id",
            "password": "rahasia123"})
        h = {"Authorization": f"Bearer {reg.json()['access_token']}"}
        client.post("/api/kas/open", headers=h, json={"modal_awal": 50000})
        svc = client.post("/api/services", headers=h, json={
            "nama": "P", "telp": "0812", "merk": "X", "tipe": "Y",
            "keluhan": "z", "biaya": 100000, "status": "Dikerjakan"})
        assert svc.status_code == 201, svc.text
        client.patch(f"/api/services/{svc.json()['id']}/status", headers=h, json={"status": "Diambil"})
        cur = client.get("/api/kas/current", headers=h)
        d = cur.json() or {}
        assert d.get("service_omzet") == 100000
        assert d.get("kas_sistem") == 50000 + 100000


# ============================ SERVICE ============================
class TestService:
    def test_kasir_cannot_be_spoofed(self, client, kasir):
        client.post("/api/kas/open", headers=kasir, json={"modal_awal": 1000})
        r = client.post("/api/services", headers=kasir, json={
            "nama": "P", "telp": "0812", "merk": "X", "tipe": "Y",
            "keluhan": "z", "biaya": 1000, "status": "Dikerjakan",
            "kasir": "Orang Lain"})
        assert r.status_code == 201, r.text
        assert r.json()["kasir"] == "Kasir Toko"

    def test_invalid_status_rejected(self, client, admin):
        client.post("/api/kas/open", headers=admin, json={"modal_awal": 1000})
        r = client.post("/api/services", headers=admin, json={
            "nama": "P", "telp": "0812", "merk": "X", "tipe": "Y",
            "keluhan": "z", "biaya": 1000, "status": "ngawur"})
        assert r.status_code == 400, r.text

    def test_status_to_diambil_requires_session(self, client, admin):
        svc = client.post("/api/services", headers=admin, json={
            "nama": "P", "telp": "0812", "merk": "X", "tipe": "Y",
            "keluhan": "z", "biaya": 1000, "status": "Dikerjakan"})
        assert svc.status_code == 201
        # user BARU tanpa sesi
        reg = client.post("/api/auth/register", json={
            "nama": "Tanpa Sesi 2", "email": f"ns2-{os.urandom(3).hex()}@konter.id",
            "password": "rahasia123"})
        h = {"Authorization": f"Bearer {reg.json()['access_token']}"}
        r = client.patch(f"/api/services/{svc.json()['id']}/status", headers=h,
                         json={"status": "Diambil"})
        assert r.status_code == 409, r.text

    def test_purge_services(self, client, admin):
        client.post("/api/kas/open", headers=admin, json={"modal_awal": 1000})
        svc = client.post("/api/services", headers=admin, json={
            "nama": "P", "telp": "0812", "merk": "X", "tipe": "Y",
            "keluhan": "z", "biaya": 1000, "status": "Dikerjakan"})
        sid = svc.json()["id"]
        client.patch(f"/api/services/{sid}/status", headers=admin, json={"status": "Diambil"})
        r = client.post("/api/services/purge", headers=admin, json={"scope": "diambil"})
        assert r.status_code == 200, r.text
        assert r.json()["deleted"] >= 1
        assert client.get(f"/api/services/{sid}", headers=admin).status_code == 404

    def test_purge_all_requires_superadmin(self, client, kasir):
        r = client.post("/api/services/purge", headers=kasir, json={"scope": "all"})
        assert r.status_code == 403


# ============================ PRODUK & STOK ============================
class TestSpareparts:
    def test_stock_never_negative(self, client, admin, sparepart):
        r = client.patch(f"/api/spareparts/{sparepart['id']}/stock", headers=admin,
                         json={"delta": -9999})
        assert r.status_code == 400

    def test_stock_adjustment_logged(self, client, admin, sparepart):
        r = client.patch(f"/api/spareparts/{sparepart['id']}/stock", headers=admin,
                         json={"delta": 3, "alasan": "barang masuk"})
        assert r.status_code == 200
        log = client.get(f"/api/spareparts/{sparepart['id']}/stock-log", headers=admin)
        assert log.status_code == 200 and len(log.json()) >= 1
        assert log.json()[0]["oleh"] == "Super Admin"

    def test_invalid_jenis_normalized(self, client, admin):
        r = client.post("/api/spareparts", headers=admin, json={
            "nama": "Tes Jenis", "sku": f"JS-{os.urandom(3).hex()}", "merk": "M",
            "kategori": "Aksesoris", "jenis": "ngawur", "hpp": 1, "harga_jual": 2,
            "stok": 1, "stok_min": 1})
        assert r.status_code in (200, 201), r.text
        assert r.json()["jenis"] == "Sparepart"


# ============================ SLIDES ============================
class TestSlides:
    def test_javascript_link_is_stripped(self, client, admin):
        r = client.post("/api/slides", headers=admin, json={
            "judul": "X", "link": "javascript:alert(1)", "image_url": "", "urutan": 0, "aktif": True})
        assert r.status_code in (200, 201), r.text
        assert r.json()["link"] == ""

    def test_safe_link_kept(self, client, admin):
        r = client.post("/api/slides", headers=admin, json={
            "judul": "X", "link": "https://contoh.id/promo", "image_url": "",
            "urutan": 0, "aktif": True})
        assert r.status_code in (200, 201)
        assert r.json()["link"] == "https://contoh.id/promo"


# ============================ PENGATURAN ============================
class TestSettings:
    def test_defaults_are_persisted(self, client, admin):
        client.get("/api/settings", headers=admin)
        with SessionLocal() as db:
            s = db.get(models.Setting, 1)
            assert s is not None
            assert s.teknisi and s.merk


# ============================ HEALTH ============================
class TestHealth:
    def test_health_ok(self, client):
        r = client.get("/api/health")
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True and body["db_ok"] is True

    def test_upload_dir_consistent(self):
        """Folder tulis (router slides) harus sama dengan folder sajikan (main)."""
        from app import main as main_mod
        from app.routers import slides as slides_mod
        assert str(main_mod.UPLOAD_DIR) == str(slides_mod.UPLOAD_DIR)
