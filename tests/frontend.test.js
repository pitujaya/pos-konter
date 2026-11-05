/* Unit test logika frontend (Node) — tanpa browser.
 *
 * Fungsi murni diambil langsung dari script.js lalu diuji perilakunya.
 * Jadi test ini selalu ikut menguji kode yang benar-benar dipakai aplikasi.
 *
 * Jalankan:  node tests/frontend.test.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const js = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

function extract(name) {
  const start = js.indexOf('function ' + name + '(');
  if (start >= 0) {
    let i = js.indexOf('{', start);
    let depth = 0;
    for (let j = i; j < js.length; j++) {
      if (js[j] === '{') depth++;
      else if (js[j] === '}') { depth--; if (depth === 0) return js.slice(start, j + 1); }
    }
    throw new Error('body tidak tertutup: ' + name);
  }
  // gaya arrow: const name = (...) => ... / (s)=>...
  const arrow = new RegExp('const\\s+' + name + '\\s*=\\s*(\\([^)]*\\)|[A-Za-z0-9_$]+)\\s*=>');
  const m = arrow.exec(js);
  if (!m) throw new Error('fungsi tidak ditemukan: ' + name);
  const startA = m.index;
  let i = js.indexOf('{', startA);
  // arrow dengan body expression (bukan blok) -> ambil sampai ';' atau newline
  if (i < 0 || js.slice(startA, i).includes('=>') === false) throw new Error('arrow gagal: ' + name);
  // pastikan '{' ada setelah '=>'
  const arrowPos = js.indexOf('=>', startA);
  if (js[arrowPos + 2] !== '{') {
    // expression body: ambil sampai koma/EOF di baris itu
    let end = js.indexOf('\n', arrowPos);
    return js.slice(startA, end);
  }
  let depth = 0;
  for (let j = i; j < js.length; j++) {
    if (js[j] === '{') depth++;
    else if (js[j] === '}') { depth--; if (depth === 0) return js.slice(startA, j + 1); }
  }
  throw new Error('body tidak tertutup: ' + name);
}

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  OK   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); }
}

// ---- stub environment (sama seperti script.js) ----
const SET = { nama: 'TOKO KITA HP' };
const normStatus = (s) => ({ 'Antri': 'Dikerjakan', 'Menunggu Sparepart': 'Dikerjakan', 'Batal': 'Cancel' }[s] || s || 'Dikerjakan');
const fmtRp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');

const sandbox = new Function(
  'SET', 'normStatus', 'fmtRp',
  extract('waNumber') + '\n' +
  extract('waPesanAmbil') + '\n' +
  extract('waHrefAmbil') + '\n' +
  'return {waNumber, waPesanAmbil, waHrefAmbil};'
);
const { waNumber, waPesanAmbil, waHrefAmbil } = sandbox(SET, normStatus, fmtRp);

console.log('=== waNumber (normalisasi nomor) ===');
ok('0812 -> 62812', waNumber('081234567890') === '6281234567890', waNumber('081234567890'));
ok('62xx tetap', waNumber('6281234567890') === '6281234567890');
ok('8xx -> 628xx', waNumber('81234567890') === '6281234567890');
ok('ada spasi/tanda', waNumber('0812-3456-7890') === '6281234567890');
ok('+62 -> 62', waNumber('+6281234567890') === '6281234567890');
ok('kosong -> kosong', waNumber('') === '');

console.log('=== waHrefAmbil (pesan "siap diambil") ===');
const svc = {
  nama: 'Pak Budi', telp: '081234567890', noService: 'SVC-2026-0012',
  merk: 'Xiaomi', tipe: 'Redmi 12C', keluhan: 'LCD pecah', biaya: 350000,
};
const href = waHrefAmbil(svc);
ok('href dibuat', typeof href === 'string' && href.startsWith('https://wa.me/6281234567890?text='), String(href).slice(0, 60));
const pesan = waPesanAmbil(svc);
ok('pesan berisi nama pelanggan', pesan.includes('Pak Budi'), pesan.slice(0, 60));
ok('pesan berisi nomor service', pesan.includes('SVC-2026-0012'));
ok('pesan berisi device', pesan.includes('Xiaomi') && pesan.includes('Redmi 12C'));
ok('pesan berisi keluhan', pesan.includes('LCD pecah'));
ok('pesan berisi total', pesan.includes('350.000'), pesan);
ok('pesan menyebut siap diambil', /siap diambil/i.test(pesan));
ok('pesan ada line break', pesan.includes('\n'));

console.log('=== guard nomor tidak valid ===');
ok('tanpa telp -> link kosong', waHrefAmbil({ ...svc, telp: '' }) === '');
ok('telp terlalu pendek -> kosong', waHrefAmbil({ ...svc, telp: '123' }) === '');
ok('telp bukan nomor -> kosong', waHrefAmbil({ ...svc, telp: 'bukan-nomor' }) === '');

console.log('=== pesan tanpa data lengkap tidak error ===');
try {
  const p = waPesanAmbil({});
  ok('pesan tetap string', typeof p === 'string' && p.length > 0);
  ok('tidak ada "undefined"', !p.includes('undefined'), p.slice(0, 80));
} catch (e) { ok('tidak error', false, e.message); }

// ================= REKAP HARIAN (computeHarianLocal) =================
console.log('=== computeHarianLocal (rekap harian) ===');
const DB = [
  { id: 1, tanggal: '2026-10-18', kasir: 'Kasir A', status: 'Diambil', biaya: 100000, wa_terkirim_at: '2026-10-18T10:00:00' },
  { id: 2, tanggal: '2026-10-18', kasir: 'Kasir A', status: 'Dikerjakan', biaya: 50000 },
  { id: 3, tanggal: '2026-10-19', kasir: 'Kasir B', status: 'Diambil', biaya: 70000 },
];
const SALES = [
  { id: 1, tanggal: '2026-10-18', kasir: 'Kasir A', total: 200000, laba: 80000, hpp_total: 120000 },
];
const EXPENSES = [
  { tanggal: '2026-10-18', dicatat_oleh: 'Kasir A', jumlah: 30000 },
  { tanggal: '2026-10-18', dicatat_oleh: 'Kasir A', jumlah: 20000, jenis: 'pendapatan' },
];

const sandbox2 = new Function(
  'DB', 'SALES', 'EXPENSES', 'normStatus',
  extract('normKasir') + '\n' + extract('matchKasir') + '\n' +
  extract('inPeriode') + '\n' + extract('computeHarianLocal') + '\n' +
  'return {computeHarianLocal};'
);
const { computeHarianLocal } = sandbox2(DB, SALES, EXPENSES, normStatus);

const h = computeHarianLocal('2026-10-18', '2026-10-19', '');
ok('2 baris (tanggal x kasir)', h.rows.length === 2, JSON.stringify(h.rows.map(r => r.tanggal + '/' + r.kasir)));
const rA = h.rows.find(r => r.tanggal === '2026-10-18' && r.kasir === 'Kasir A');
ok('svc_masuk A = 2', rA && rA.svc_masuk === 2, JSON.stringify(rA));
ok('svc_diambil A = 1', rA && rA.svc_diambil === 1);
ok('svc_omzet A = 100000', rA && rA.svc_omzet === 100000);
ok('nota A = 1', rA && rA.nota === 1);
ok('omzet jual A = 200000', rA && rA.jual_omzet === 200000);
ok('laba jual A = 80000', rA && rA.jual_laba === 80000);
ok('exp A = 30000 (pendapatan lain tidak masuk biaya)', rA && rA.exp === 30000);
ok('inc A = 20000', rA && rA.inc === 20000, rA && rA.inc);
ok('WA A = 1', rA && rA.wa_terkirim === 1);
ok('total laba A = 100000+80000-30000+20000 = 170000', rA && rA.total_laba === 170000, rA && rA.total_laba);
ok('total pendapatan A = 100000+200000+20000 = 320000', rA && rA.total_pendapatan === 320000);

const rB = h.rows.find(r => r.kasir === 'Kasir B');
ok('kasir B tanpa penjualan', rB && rB.nota === 0 && rB.jual_omzet === 0);
ok('kasir B laba = 70000', rB && rB.total_laba === 70000);

ok('ringkasan hari = 2', h.ringkasan.hari === 2, h.ringkasan.hari);
ok('ringkasan svc_masuk = 3', h.ringkasan.svc_masuk === 3);
ok('ringkasan svc_diambil = 2', h.ringkasan.svc_diambil === 2);
ok('ringkasan omzet = 170000', h.ringkasan.svc_omzet === 170000);
ok('ringkasan pendapatan lain = 20000', h.ringkasan.inc === 20000, h.ringkasan.inc);
ok('ringkasan laba = 240000', h.ringkasan.total_laba === 240000, h.ringkasan.total_laba);
ok('ringkasan WA = 1', h.ringkasan.wa_terkirim === 1);

console.log('--- jenis biaya / pendapatan lain ---');
{
  const exJenis = new Function(extract('exJenis') + '\nreturn exJenis;')();
  ok('jenis kosong -> biaya', exJenis({}) === 'biaya');
  ok('jenis biaya -> biaya', exJenis({ jenis: 'biaya' }) === 'biaya');
  ok('jenis pendapatan -> pendapatan', exJenis({ jenis: 'pendapatan' }) === 'pendapatan');
  ok('jenis PENDAPATAN (kapital) -> pendapatan', exJenis({ jenis: ' PENDAPATAN ' }) === 'pendapatan');
  ok('jenis tidak dikenal -> biaya', exJenis({ jenis: 'xyz' }) === 'biaya');
}

console.log('--- filter ---');
const hA = computeHarianLocal('2026-10-18', '2026-10-19', 'Kasir A');
ok('filter kasir -> hanya Kasir A', hA.rows.length === 1 && hA.rows[0].kasir === 'Kasir A');
const hPeriode = computeHarianLocal('2026-10-19', '2026-10-19', '');
ok('filter periode -> hanya 19 Okt', hPeriode.rows.length === 1 && hPeriode.rows[0].tanggal === '2026-10-19');
const hKosong = computeHarianLocal('2020-01-01', '2020-01-02', '');
ok('periode tanpa data -> rows kosong', hKosong.rows.length === 0);
ok('periode kosong -> ringkasan nol', hKosong.ringkasan.total_laba === 0);

console.log('\n=== laporan per sesi kasir ===');
const LP_SESI_LIST = [{
  id: 1, kasir: 'Kasir A', status: 'closed',
  opened_at: '2026-10-18T00:00:00', closed_at: '2026-10-19T23:59:59',
}];
const DB_SESI = [
  ...DB,
  { id: 4, tanggal: '2026-10-20', kasir: 'Kasir A', status: 'Diambil', biaya: 999999 },
];
const sandbox3 = new Function(
  'DB', 'SALES', 'EXPENSES', 'LP_SESI_LIST', 'normStatus',
  extract('parseTs') + '\n' + extract('tsRecord') + '\n' +
  extract('tsServiceCreated') + '\n' + extract('tsServiceStatus') + '\n' +
  extract('normKasir') + '\n' + extract('matchKasir') + '\n' +
  extract('inPeriode') + '\n' + extract('lpSessionById') + '\n' +
  extract('lpSesiWindow') + '\n' + extract('lpInWindow') + '\n' +
  extract('computeHarianLocal') + '\n' +
  'return {computeHarianLocal};'
);
const { computeHarianLocal: computeHarianSesi } = sandbox3(
  DB_SESI, SALES, EXPENSES, LP_SESI_LIST, normStatus
);
const hs = computeHarianSesi('2000-01-01', '2000-01-01', '', 1);
ok('sesi lintas tanggal: 2 baris', hs.rows.length === 2, JSON.stringify(hs.rows.map(r => r.tanggal)));
ok('sesi: svc_masuk = 3', hs.ringkasan.svc_masuk === 3, hs.ringkasan.svc_masuk);
ok('sesi: svc_diambil = 2', hs.ringkasan.svc_diambil === 2, hs.ringkasan.svc_diambil);
ok('sesi: omzet service = 170000', hs.ringkasan.svc_omzet === 170000, hs.ringkasan.svc_omzet);
ok('sesi: penjualan = 200000', hs.ringkasan.jual_omzet === 200000);
ok('sesi: biaya = 30000', hs.ringkasan.exp === 30000);
ok('sesi: pendapatan lain = 20000', hs.ringkasan.inc === 20000);
ok('transaksi di luar sesi tidak ikut', hs.ringkasan.svc_omzet !== 1169999);

console.log('\n=== hak akses (normAkses & bolehAkses) ===');
const aksesStart = js.indexOf('const AKSES_DEF');
const aksesEnd = js.indexOf('let SET = loadSetting();');
const aksesCode = js.slice(aksesStart, aksesEnd);
function makeAkses(role, akses) {
  const fn = new Function('myRole', 'SET',
    aksesCode + '\nreturn {AKSES_DEF, normAkses, aksesOn, bolehAkses};');
  const set = { akses: null };
  const api = fn(() => role, set);
  set.akses = api.normAkses(akses || {});
  return api;
}
const sa = makeAkses('superadmin', { kasir_lihat_laba: false, admin_ubah_produk: false });
ok('11 izin didefinisikan', Object.keys(sa.AKSES_DEF).length === 11);
ok('default semua izin aktif', Object.values(sa.normAkses({})).every(v => v === true));
ok('override false dihormati', sa.normAkses({ kasir_lihat_laba: false }).kasir_lihat_laba === false);
ok('key tak dikenal diabaikan', !('xyz' in sa.normAkses({ xyz: false })));
ok('superadmin selalu boleh', sa.bolehAkses('kasir_lihat_laba') && sa.bolehAkses('admin_ubah_produk'));
const ad = makeAkses('admin', { admin_ubah_produk: false, kasir_lihat_laba: false });
ok('admin terkena izin admin_*', ad.bolehAkses('admin_ubah_produk') === false);
ok('admin tidak terkena izin kasir_*', ad.bolehAkses('kasir_lihat_laba') === true);
const ks = makeAkses('kasir', { kasir_penjualan_tempo: false, admin_hapus_penjualan: false });
ok('kasir terkena izin kasir_*', ks.bolehAkses('kasir_penjualan_tempo') === false);
ok('kasir tetap tidak punya izin admin_*', ks.bolehAkses('admin_hapus_penjualan') === false);

console.log('\n=== dashboard per sesi kasir ===');
const dashCode = [
  extract('dashNormKasir'), extract('dashboardSesi'), extract('dalamSesi'),
  extract('tsServiceCreated'), extract('tsServiceStatus')
].join('\n');
function makeDash(role, kas) {
  const fn = new Function('KAS', 'myRole', 'kasSesiAktif', 'parseTs',
    dashCode + '\nreturn {dashNormKasir, dashboardSesi, dalamSesi, tsServiceCreated, tsServiceStatus};');
  const parseTs = (s) => {
    if (!s) return 0;
    let str = String(s).trim().replace(' ', 'T');
    if (!/(Z|[+-]\d{2}:?\d{2})$/.test(str)) str += 'Z';
    const t = Date.parse(str);
    return isNaN(t) ? 0 : t;
  };
  return fn(kas, () => role, () => !!(kas && kas.status === 'open'), parseTs);
}
const kasOpen = { status: 'open', opened_at: '2026-11-03T10:00:00', kasir: 'Kasir A' };
const dk = makeDash('kasir', kasOpen);
ok('kasir: sesi terdeteksi', dk.dashboardSesi().open && dk.dashboardSesi().kasir === 'kasir a');
ok('kasir: window memakai opened_at', dk.dashboardSesi().t0 === Date.parse('2026-11-03T10:00:00Z'));
ok('di luar window ditolak', !dk.dalamSesi(Date.parse('2026-11-03T09:59:00Z'), dk.dashboardSesi()));
ok('di dalam window diterima', dk.dalamSesi(Date.parse('2026-11-03T10:01:00Z'), dk.dashboardSesi()));
ok('bukan kasir -> global', makeDash('admin', kasOpen).dashboardSesi() === null);
ok('kas tutup -> open false', makeDash('kasir', null).dashboardSesi().open === false);
const svcUnsorted = { created_at: '', riwayat: [
  { t: '2026-11-03T10:05:00', s: 'Selesai' },
  { t: '2026-11-03T10:00:00', s: 'Dikerjakan' },
] };
ok('created dari riwayat paling awal', dk.tsServiceCreated(svcUnsorted) === Date.parse('2026-11-03T10:00:00Z'));
ok('status Diambil terakhir', dk.tsServiceStatus({ riwayat: [
  { t: '2026-11-03T10:00:00', s: 'Diambil' },
  { t: '2026-11-03T11:00:00', s: 'Diambil' },
] }, 'Diambil') === Date.parse('2026-11-03T11:00:00Z'));

console.log('\n=== RINGKASAN ===');
console.log(`  ${pass} lulus, ${fail} gagal`);
process.exit(fail ? 1 : 0);
