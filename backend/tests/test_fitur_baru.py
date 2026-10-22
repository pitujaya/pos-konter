"""Test fitur baru: notifikasi WhatsApp + Rekap Harian per Kasir."""
import os
import sys
import tempfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

_TMP = tempfile.mkdtemp(prefix="servishp-feat-")
os.environ["DATABASE_URL"] = f"sqlite:///{_TMP}/feat.db"
os.environ["SECRET_KEY"] = "test-secret-key-0123456789-0123456789-abcdef"
os.environ["UPLOAD_DIR"] = f"{_TMP}/uploads"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

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


def _make_service(kasir, tanggal, biaya, status="Dikerjakan", nama="P"):
    with SessionLocal() as db:
        s = models.Service(
            no_service=f"SVC-{tanggal.replace('-','')}-{os.urandom(3).hex()}",
            tanggal=tanggal, nama=nama, telp="0812", merk="Xiaomi", tipe="Redmi",
            keluhan="rusak", biaya=biaya, status=status, kasir=kasir,
        )
        db.add(s)
        db.commit()
        db.refresh(s)
        return s.id


# ==================== NOTIFIKASI WHATSAPP ====================
class TestWaNotifikasi:
    def test_mark_wa_sent(self, client, admin):
        sid = _make_service("Kasir Toko", "2026-10-20", 100000)
        r = client.post(f"/api/services/{sid}/wa-notifikasi", headers=admin, json={})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["wa_terkirim_at"], "wa_terkirim_at harus terisi"
        assert body["wa_terkirim_oleh"] == "Super Admin"

    def test_wa_sent_persists(self, client, admin):
        sid = _make_service("Kasir Toko", "2026-10-20", 100000)
        client.post(f"/api/services/{sid}/wa-notifikasi", headers=admin, json={})
        r = client.get(f"/api/services/{sid}", headers=admin)
        assert r.status_code == 200
        assert r.json()["wa_terkirim_at"]

    def test_mark_wa_sent_404(self, client, admin):
        r = client.post("/api/services/999999/wa-notifikasi", headers=admin, json={})
        assert r.status_code == 404

    def test_mark_wa_sent_requires_auth(self, client):
        r = client.post("/api/services/1/wa-notifikasi", json={})
        assert r.status_code == 401

    def test_wa_columns_exist(self):
        with SessionLocal() as db:
            cols = {c.name for c in models.Service.__table__.columns}
        assert "wa_terkirim_at" in cols and "wa_terkirim_oleh" in cols


# ==================== REKAP HARIAN ====================
class TestRekapHarian:
    def test_shape(self, client, admin):
        r = client.get("/api/stats/harian", headers=admin)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "rows" in body and "ringkasan" in body
        assert set(body["ringkasan"].keys()) >= {
            "hari", "svc_masuk", "svc_diambil", "svc_omzet", "nota",
            "jual_omzet", "jual_laba", "exp", "wa_terkirim",
            "total_pendapatan", "total_laba",
        }

    def test_rows_grouped_by_tanggal_dan_kasir(self, client, admin):
        _make_service("Kasir Harian", "2026-10-18", 50000)
        _make_service("Kasir Harian", "2026-10-18", 70000)
        _make_service("Kasir Harian", "2026-10-19", 90000, status="Diambil")
        r = client.get("/api/stats/harian", headers=admin,
                       params={"dari": "2026-10-18", "sampai": "2026-10-19"})
        assert r.status_code == 200
        rows = r.json()["rows"]
        key = [x for x in rows if x["tanggal"] == "2026-10-18" and x["kasir"] == "Kasir Harian"]
        assert key, "baris 2026-10-18 / Kasir Harian tidak ada"
        assert key[0]["svc_masuk"] == 2
        assert key[0]["svc_diambil"] == 0
        key2 = [x for x in rows if x["tanggal"] == "2026-10-19"]
        assert key2 and key2[0]["svc_diambil"] == 1
        assert key2[0]["svc_omzet"] == 90000

    def test_laba_per_baris(self, client, admin):
        sid = _make_service("Kasir Laba", "2026-10-17", 100000, status="Diambil")
        r = client.get("/api/stats/harian", headers=admin,
                       params={"dari": "2026-10-17", "sampai": "2026-10-17"})
        rows = [x for x in r.json()["rows"] if x["kasir"] == "Kasir Laba"]
        assert rows
        # laba = omzet service + laba jual - pengeluaran
        assert rows[0]["total_laba"] == rows[0]["svc_omzet"] + rows[0]["jual_laba"] - rows[0]["exp"]

    def test_filter_kasir(self, client, admin):
        _make_service("Kasir A", "2026-10-16", 10000)
        _make_service("Kasir B", "2026-10-16", 20000)
        r = client.get("/api/stats/harian", headers=admin, params={"kasir": "Kasir A"})
        assert r.status_code == 200
        assert all(x["kasir"] == "Kasir A" for x in r.json()["rows"])

    def test_ringkasan_konsisten_dengan_rows(self, client, admin):
        _make_service("Kasir Ringkas", "2026-10-15", 30000, status="Diambil")
        r = client.get("/api/stats/harian", headers=admin)
        body = r.json()
        rk = body["ringkasan"]
        assert rk["svc_omzet"] == sum(x["svc_omzet"] for x in body["rows"])
        assert rk["total_laba"] == sum(x["total_laba"] for x in body["rows"])
        assert rk["svc_diambil"] == sum(x["svc_diambil"] for x in body["rows"])

    def test_wa_terkirim_terhitung(self, client, admin):
        sid = _make_service("Kasir WA", "2026-10-14", 50000)
        client.post(f"/api/services/{sid}/wa-notifikasi", headers=admin, json={})
        r = client.get("/api/stats/harian", headers=admin,
                       params={"dari": "2026-10-14", "sampai": "2026-10-14"})
        rows = [x for x in r.json()["rows"] if x["kasir"] == "Kasir WA"]
        assert rows and rows[0]["wa_terkirim"] >= 1

    def test_requires_auth(self, client):
        assert client.get("/api/stats/harian").status_code == 401
