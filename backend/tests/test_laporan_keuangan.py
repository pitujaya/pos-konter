"""Test laporan keuangan: arus kas, posisi keuangan, dan laba per kategori."""
import os
import sys
import tempfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

_TMP = tempfile.mkdtemp(prefix="servishp-keu-")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_TMP}/keu.db")
os.environ.setdefault("SECRET_KEY", "test-secret-key-0123456789-0123456789-abcdef")
os.environ.setdefault("UPLOAD_DIR", f"{_TMP}/uploads")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


class TestLaporanKeuangan:
    TGL = "2032-06-15"

    def _user(self, client, modal=50000):
        nama = f"Kasir Keu {os.urandom(3).hex()}"
        reg = client.post("/api/auth/register", json={
            "nama": nama,
            "email": f"keu-{os.urandom(4).hex()}@konter.id",
            "password": "rahasia123",
        })
        assert reg.status_code == 200, reg.text
        h = {"Authorization": f"Bearer {reg.json()['access_token']}"}
        r = client.post("/api/kas/open", headers=h, json={"modal_awal": modal})
        assert r.status_code in (200, 201), r.text
        return h, nama

    def _service(self, client, h, biaya, merk="TestMerk", status="Diambil", metode="tunai"):
        r = client.post("/api/services", headers=h, json={
            "tanggal": self.TGL, "nama": "Pelanggan", "telp": "0812",
            "merk": merk, "tipe": "Tipe", "keluhan": "rusak",
            "biaya": biaya, "status": "Dikerjakan", "metode_bayar": metode,
        })
        assert r.status_code == 201, r.text
        sid = r.json()["id"]
        if status == "Diambil":
            st = client.patch(f"/api/services/{sid}/status", headers=h, json={"status": "Diambil"})
            assert st.status_code == 200, st.text
        return sid

    def _expense(self, client, h, jumlah, jenis="biaya", metode="tunai", kategori="Operasional"):
        r = client.post("/api/expenses", headers=h, json={
            "tanggal": self.TGL, "jenis": jenis, "kategori": kategori,
            "keterangan": "test", "jumlah": jumlah, "metode": metode,
        })
        assert r.status_code == 201, r.text
        return r.json()

    def test_arus_kas_tunai(self, client):
        h, kasir = self._user(client, modal=50000)
        self._service(client, h, 100000)
        self._expense(client, h, 20000, jenis="pendapatan", kategori="Bunga")
        self._expense(client, h, 30000, jenis="biaya", kategori="Listrik")

        r = client.get("/api/stats/arus-kas", headers=h,
                       params={"kasir": kasir})
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["kas_awal"] == 50000
        assert b["penerimaan"]["service_tunai"] == 100000
        assert b["penerimaan"]["pendapatan_lain_tunai"] == 20000
        assert b["penerimaan"]["total"] == 120000
        assert b["pengeluaran"]["total"] == 30000
        assert b["arus_kas_bersih"] == 90000
        assert b["kas_akhir_sistem"] == 140000
        assert b["sesi"], "sesi kasir harus muncul"

    def test_arus_kas_non_tunai_tidak_masuk_kas(self, client):
        h, kasir = self._user(client, modal=10000)
        self._service(client, h, 50000, metode="transfer")
        self._expense(client, h, 40000, metode="transfer")

        b = client.get("/api/stats/arus-kas", headers=h,
                       params={"dari": self.TGL, "sampai": self.TGL, "kasir": kasir}).json()
        assert b["penerimaan"]["service_tunai"] == 0
        assert b["pengeluaran"]["total"] == 0
        assert b["arus_kas_bersih"] == 0
        assert b["non_tunai"]["service"] == 50000
        assert b["non_tunai"]["pengeluaran"] == 40000

    def test_neraca_ringkas(self, client):
        h, kasir = self._user(client, modal=50000)
        self._service(client, h, 100000)
        self._expense(client, h, 30000)

        r = client.get("/api/stats/neraca", headers=h,
                       params={"tanggal": self.TGL, "kasir": kasir})
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["aset"]["kas"] == 120000
        assert b["ekuitas"]["modal"] == 50000
        assert b["ekuitas"]["laba_ditahan"] == 70000
        assert b["ekuitas"]["total"] == 120000
        assert b["selisih"] == b["aset"]["total"] - b["ekuitas"]["total"]
        assert b["kewajiban"]["total"] == 0

    def test_per_kategori_service(self, client):
        h, kasir = self._user(client)
        self._service(client, h, 40000, merk="MerkUji")
        self._service(client, h, 60000, merk="MerkUji")

        r = client.get("/api/stats/per-kategori", headers=h,
                       params={"dari": self.TGL, "sampai": self.TGL, "kasir": kasir})
        assert r.status_code == 200, r.text
        b = r.json()
        row = [x for x in b["service"] if x["merk"] == "MerkUji"]
        assert row, b["service"]
        assert row[0]["jumlah"] == 2
        assert row[0]["omzet"] == 100000

    def _session_id(self, client, h):
        r = client.get("/api/kas/current", headers=h)
        assert r.status_code == 200, r.text
        return r.json()["id"]

    def test_report_per_sesi_mengabaikan_tanggal(self, client):
        h, kasir = self._user(client, modal=50000)
        sid = self._session_id(client, h)
        self._service(client, h, 100000)
        self._expense(client, h, 30000)

        r = client.get("/api/stats/report", headers=h, params={
            "sesi_id": sid, "dari": "2000-01-01", "sampai": "2000-01-01",
        })
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["sesi_id"] == sid
        assert b["service_masuk"] == 1
        assert b["service_selesai"] == 1
        assert b["service_omzet"] == 100000
        assert b["expense_total"] == 30000
        assert b["total_laba"] == 70000

    def test_report_per_sesi_isolasi_kasir(self, client):
        h1, _ = self._user(client)
        sid1 = self._session_id(client, h1)
        h2, _ = self._user(client)
        sid2 = self._session_id(client, h2)
        self._service(client, h1, 100000)

        r = client.get("/api/stats/report", headers=h2, params={"sesi_id": sid1})
        assert r.status_code == 403, r.text
        b = client.get("/api/stats/report", headers=h2, params={"sesi_id": sid2}).json()
        assert b["sesi_id"] == sid2
        assert b["service_omzet"] == 0

    def test_report_harian_per_sesi(self, client):
        h, kasir = self._user(client)
        sid = self._session_id(client, h)
        self._service(client, h, 100000)
        self._expense(client, h, 30000)

        r = client.get("/api/stats/harian", headers=h, params={"sesi_id": sid})
        assert r.status_code == 200, r.text
        b = r.json()
        rows = b["rows"]
        assert sum(x["svc_masuk"] for x in rows) == 1
        assert sum(x["svc_diambil"] for x in rows) == 1
        assert sum(x["svc_omzet"] for x in rows) == 100000
        assert sum(x["exp"] for x in rows) == 30000

    def test_neraca_per_sesi_kumulatif(self, client):
        h, kasir = self._user(client, modal=50000)
        sid = self._session_id(client, h)
        self._service(client, h, 100000)
        closed = client.post(f"/api/kas/{sid}/close", headers=h, json={"kas_akhir": 150000})
        assert closed.status_code == 200, closed.text
        reopened = client.post("/api/kas/open", headers=h, json={"modal_awal": 0})
        assert reopened.status_code in (200, 201), reopened.text
        self._expense(client, h, 30000)

        b = client.get("/api/stats/neraca", headers=h, params={"sesi_id": sid}).json()
        assert b["sesi_id"] == sid
        assert b["ekuitas"]["laba_ditahan"] == 100000
        assert b["aset"]["kas"] == 150000
        assert b["ekuitas"]["total"] == 150000

    def test_requires_auth(self, client):
        assert client.get("/api/stats/arus-kas").status_code == 401
        assert client.get("/api/stats/neraca").status_code == 401
        assert client.get("/api/stats/per-kategori").status_code == 401
