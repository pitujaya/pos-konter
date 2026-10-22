"""Regresi: proses deploy/restart TIDAK boleh menghapus data yang sudah ada.

Simulasikan siklus yang terjadi di server saat auto-update berjalan:
  1. create_all (bikin tabel yang belum ada)
  2. migrasi kolom (ALTER TABLE ADD COLUMN)
  3. seed() (data awal)
，然后 pastikan semua record lama masih utuh persis.
"""
import os
import sys
import tempfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

_TMP = tempfile.mkdtemp(prefix="servishp-mig-")
os.environ["DATABASE_URL"] = f"sqlite:///{_TMP}/mig.db"
os.environ["SECRET_KEY"] = "test-secret-key-0123456789-0123456789-abcdef"
os.environ["UPLOAD_DIR"] = f"{_TMP}/uploads"

from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app import models  # noqa: E402
from app.seed import seed  # noqa: E402
from app.database import Base  # noqa: E402


def _engine():
    return create_engine(f"sqlite:///{_TMP}/mig.db", future=True)


def _run_startup():
    """Simulasikan apa yang dilakukan main.py saat start."""
    engine = _engine()
    Base.metadata.create_all(bind=engine)

    from app.main import _ensure_columns, _ensure_index  # noqa: E402
    _ensure_columns("spareparts", {
        "kategori": "VARCHAR(80) DEFAULT 'Lainnya'",
        "jenis": "VARCHAR(40) DEFAULT 'Sparepart'",
    })
    _ensure_columns("services", {
        "kasir": "VARCHAR(120) DEFAULT ''",
        "metode_bayar": "VARCHAR(30) DEFAULT 'tunai'",
    })
    _ensure_columns("cash_sessions", {"service_tunai": "INTEGER DEFAULT 0"})

    Session = sessionmaker(bind=engine, future=True)
    with Session() as db:
        seed(db)
    return engine, Session


def test_deploy_preserves_existing_data():
    engine, Session = _run_startup()

    # --- isi data "produksi" ---
    with Session() as db:
        user = models.User(nama="Kasir Rhea", email="rhea@konter.id",
                           hp="0812999", password_hash="x", role="kasir")
        db.add(user)
        db.flush()
        sp = models.Sparepart(nama="LCD A12", sku="LCD-TEST-1", merk="Samsung",
                              hpp=100000, harga_jual=150000, stok=4, stok_min=1)
        db.add(sp)
        db.flush()
        svc = models.Service(no_service="SVC-2020-0001", tanggal="2020-01-01",
                             nama="Pak Budi", telp="0812", merk="Samsung", tipe="A12",
                             keluhan="pecah", biaya=350000, status="Diambil", dp=50000)
        db.add(svc)
        db.flush()
        db.add(models.ServiceHistory(service_id=svc.id, status="Diambil"))
        sale = models.Sale(no_nota="SL-2020-0001", tanggal="2020-01-01",
                           pelanggan="Bu Tuti", total=150000, hpp_total=100000,
                           laba=50000, metode="Tunai", kasir="Kasir Rhea")
        db.add(sale)
        db.flush()
        db.add(models.SaleItem(sale_id=sale.id, sparepart_id=sp.id, sku="LCD-TEST-1",
                               nama="LCD A12", hpp=100000, harga=150000, qty=1,
                               subtotal=150000))
        db.add(models.Expense(kategori="Operasional", keterangan="Listrik",
                               jumlah=50000, dicatat_oleh="Kasir Rhea"))
        sess = models.CashSession(user_id=user.id, kasir="Kasir Rhea", status="closed",
                                   modal_awal=100000, opened_at=svc.created_at,
                                   closed_at=svc.created_at, kas_sistem=450000,
                                   kas_akhir=450000, selisih=0)
        db.add(sess)
        db.commit()
        user_id = user.id
        svc_id = svc.id
        sale_id = sale.id

    # --- jalankan siklus startup/deploy lagi (2x, seperti restart berulang) ---
    _run_startup()
    _run_startup()

    # --- semua data lama harus utuh ---
    with Session() as db:
        assert db.query(models.User).filter(models.User.id == user_id).count() == 1
        u = db.get(models.User, user_id)
        assert u.nama == "Kasir Rhea" and u.email == "rhea@konter.id" and u.role == "kasir"

        s = db.get(models.Service, svc_id)
        assert s is not None
        assert s.nama == "Pak Budi" and s.biaya == 350000 and s.dp == 50000
        assert s.status == "Diambil"
        assert len(s.histories) == 1

        assert db.query(models.Sale).filter(models.Sale.id == sale_id).count() == 1
        sa = db.get(models.Sale, sale_id)
        assert sa.total == 150000 and sa.laba == 50000 and sa.pelanggan == "Bu Tuti"
        assert len(sa.items) == 1

        assert db.query(models.Expense).count() == 1
        assert db.query(models.Expense).first().jumlah == 50000

        assert db.query(models.CashSession).count() == 1
        cs = db.query(models.CashSession).first()
        assert cs.modal_awal == 100000 and cs.kas_sistem == 450000

        assert db.query(models.Sparepart).filter(
            models.Sparepart.sku == "LCD-TEST-1").count() == 1
        assert db.get(models.Sparepart, db.query(models.Sparepart).filter(
            models.Sparepart.sku == "LCD-TEST-1").first().id).stok == 4


def test_new_columns_get_defaults_not_null():
    """Kolom baru harus terisi default, record lama tetap terbaca."""
    engine, Session = _run_startup()
    with engine.connect() as conn:
        cols = {r[1] for r in conn.exec_driver_sql("PRAGMA table_info(services)").fetchall()}
        assert "metode_bayar" in cols and "kasir" in cols
        cols2 = {r[1] for r in conn.exec_driver_sql("PRAGMA table_info(cash_sessions)").fetchall()}
        assert "service_tunai" in cols2
        cols3 = {r[1] for r in conn.exec_driver_sql("PRAGMA table_info(spareparts)").fetchall()}
        assert "jenis" in cols3 and "kategori" in cols3


def test_seed_does_not_duplicate_when_data_exists():
    """seed() hanya jalan saat tabel kosong -> tidak menggandakan data."""
    engine, Session = _run_startup()
    with Session() as db:
        n_users = db.query(models.User).count()
        n_sp = db.query(models.Sparepart).count()
    _run_startup()
    with Session() as db:
        assert db.query(models.User).count() == n_users
        assert db.query(models.Sparepart).count() == n_sp
