"""Test modul pembelian stok: stok masuk, HPP rata-rata tertimbang, audit & akses."""
import os
import sys
import tempfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

_TMP = tempfile.mkdtemp(prefix="servishp-beli-")
os.environ["DATABASE_URL"] = f"sqlite:///{_TMP}/beli.db"
os.environ["SECRET_KEY"] = "test-secret-key-0123456789-0123456789-abcdef"
os.environ["UPLOAD_DIR"] = f"{_TMP}/uploads"
os.environ["ALLOW_PUBLIC_REGISTER"] = "1"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.auth import hash_password  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app import models  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def admin(client):
    r = client.post("/api/auth/login", json={"identifier": "admin@konter.id", "password": "admin123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def kasir(client):
    r = client.post("/api/auth/login", json={
        "identifier": "kasir.toko@konter.id", "password": "kasir123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def admin_tanpa_sesi(client):
    email = f"admin-baru-{os.urandom(3).hex()}@konter.id"
    with SessionLocal() as db:
        db.add(models.User(
            nama="Admin Baru", email=email, hp=f"08{os.urandom(6).hex()}",
            password_hash=hash_password("rahasia123"), role="admin"))
        db.commit()
    r = client.post("/api/auth/login", json={"identifier": email, "password": "rahasia123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _sparepart(hpp=1000, jual=2000, stok=10):
    with SessionLocal() as db:
        sp = models.Sparepart(
            nama="LCD Test", sku=f"LCD-{os.urandom(4).hex()}", merk="X",
            kategori="LCD", jenis="Sparepart", hpp=hpp, harga_jual=jual,
            stok=stok, stok_min=1)
        db.add(sp)
        db.commit()
        db.refresh(sp)
        return sp.id


def _stok(sp_id):
    with SessionLocal() as db:
        sp = db.get(models.Sparepart, sp_id)
        return int(sp.stok or 0), int(sp.hpp or 0), int(sp.harga_jual or 0)


class TestPembelian:
    def test_butuh_sesi_kasir(self, client, admin_tanpa_sesi):
        sp_id = _sparepart()
        r = client.post("/api/purchases", headers=admin_tanpa_sesi, json={
            "items": [{"sparepart_id": sp_id, "harga_beli": 2000, "qty": 1}]})
        assert r.status_code == 409, r.text

    def test_kasir_ditolak(self, client, kasir, admin):
        client.post("/api/kas/open", headers=admin, json={"modal_awal": 100000})
        r = client.post("/api/purchases", headers=kasir, json={
            "items": [{"sparepart_id": _sparepart(), "harga_beli": 1000, "qty": 1}]})
        assert r.status_code == 403, r.text

    def test_create_stok_hpp_dan_audit(self, client, admin):
        sp_id = _sparepart(hpp=1000, jual=2000, stok=10)
        r = client.post("/api/purchases", headers=admin, json={
            "tanggal": "2026-11-26", "supplier": "PT Sinar", "metode": "Tunai",
            "diskon": 0,
            "items": [{"sparepart_id": sp_id, "harga_beli": 2000, "harga_jual": 3000, "qty": 10}]})
        assert r.status_code == 201, r.text
        p = r.json()
        assert p["no_nota"].startswith("PB-")
        assert p["supplier"] == "PT Sinar"
        assert p["total"] == 20000
        assert p["items"][0]["harga_beli"] == 2000
        assert p["items"][0]["nama"] == "LCD Test"
        assert _stok(sp_id) == (20, 1500, 3000)
        with SessionLocal() as db:
            log = db.query(models.StockAdjustment).filter(
                models.StockAdjustment.sparepart_id == sp_id).all()
            assert any(x.delta == 10 and x.stok_akhir == 20 and p["no_nota"] in x.alasan for x in log)

    def test_list_detail_dan_filter(self, client, admin):
        r = client.get("/api/purchases", headers=admin, params={"q": "PT Sinar"})
        assert r.status_code == 200, r.text
        rows = r.json()
        assert rows and all("PT Sinar" in x["supplier"] for x in rows)
        detail = client.get(f"/api/purchases/{rows[0]['id']}", headers=admin)
        assert detail.status_code == 200 and detail.json()["id"] == rows[0]["id"]

    def test_kas_sesi_mencatat_pembelian(self, client, admin):
        r = client.get("/api/kas/current", headers=admin)
        assert r.status_code == 200, r.text
        s = r.json()
        assert s["pembelian_count"] >= 1
        assert s["pembelian_tunai"] >= 20000

    def test_laporan_mencatat_pembelian(self, client, admin):
        r = client.get("/api/stats/report", headers=admin)
        assert r.status_code == 200, r.text
        assert r.json()["pembelian_total"] >= 20000
        a = client.get("/api/stats/arus-kas", headers=admin)
        assert a.status_code == 200, a.text
        assert a.json()["pengeluaran"]["pembelian_tunai"] >= 20000

    def test_update_header_tanpa_ubah_stok(self, client, admin):
        sp_id = _sparepart()
        before = _stok(sp_id)
        created = client.post("/api/purchases", headers=admin, json={
            "supplier": "Supplier A",
            "items": [{"sparepart_id": sp_id, "harga_beli": 500, "qty": 2}]})
        assert created.status_code == 201, created.text
        pid = created.json()["id"]
        assert _stok(sp_id)[0] == before[0] + 2
        upd = client.put(f"/api/purchases/{pid}", headers=admin, json={"supplier": "Supplier B"})
        assert upd.status_code == 200, upd.text
        assert upd.json()["supplier"] == "Supplier B"
        assert _stok(sp_id)[0] == before[0] + 2

    def test_transfer_tidak_mengurangi_kas(self, client, admin):
        sp_id = _sparepart(hpp=1000, jual=2000, stok=10)
        before = client.get("/api/kas/current", headers=admin).json()["kas_sistem"]
        r = client.post("/api/purchases", headers=admin, json={
            "metode": "Transfer",
            "items": [{"sparepart_id": sp_id, "harga_beli": 1000, "qty": 3}]})
        assert r.status_code == 201, r.text
        after = client.get("/api/kas/current", headers=admin).json()["kas_sistem"]
        assert after == before

    def test_hapus_mengurangi_stok(self, client, admin):
        sp_id = _sparepart(hpp=500, jual=1000, stok=10)
        created = client.post("/api/purchases", headers=admin, json={
            "items": [{"sparepart_id": sp_id, "harga_beli": 700, "qty": 5}]})
        assert created.status_code == 201, created.text
        pid = created.json()["id"]
        assert _stok(sp_id)[0] == 15
        h = client.delete(f"/api/purchases/{pid}", headers=admin)
        assert h.status_code == 200 and h.json()["ok"] is True
        assert _stok(sp_id)[0] == 10
        assert client.get(f"/api/purchases/{pid}", headers=admin).status_code == 404
