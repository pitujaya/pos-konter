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
ok('exp A = 30000', rA && rA.exp === 30000);
ok('WA A = 1', rA && rA.wa_terkirim === 1);
ok('total laba A = 100000+80000-30000 = 150000', rA && rA.total_laba === 150000, rA && rA.total_laba);
ok('total pendapatan A = 100000+200000 = 300000', rA && rA.total_pendapatan === 300000);

const rB = h.rows.find(r => r.kasir === 'Kasir B');
ok('kasir B tanpa penjualan', rB && rB.nota === 0 && rB.jual_omzet === 0);
ok('kasir B laba = 70000', rB && rB.total_laba === 70000);

ok('ringkasan hari = 2', h.ringkasan.hari === 2, h.ringkasan.hari);
ok('ringkasan svc_masuk = 3', h.ringkasan.svc_masuk === 3);
ok('ringkasan svc_diambil = 2', h.ringkasan.svc_diambil === 2);
ok('ringkasan omzet = 170000', h.ringkasan.svc_omzet === 170000);
ok('ringkasan laba = 220000', h.ringkasan.total_laba === 220000, h.ringkasan.total_laba);
ok('ringkasan WA = 1', h.ringkasan.wa_terkirim === 1);

console.log('--- filter ---');
const hA = computeHarianLocal('2026-10-18', '2026-10-19', 'Kasir A');
ok('filter kasir -> hanya Kasir A', hA.rows.length === 1 && hA.rows[0].kasir === 'Kasir A');
const hPeriode = computeHarianLocal('2026-10-19', '2026-10-19', '');
ok('filter periode -> hanya 19 Okt', hPeriode.rows.length === 1 && hPeriode.rows[0].tanggal === '2026-10-19');
const hKosong = computeHarianLocal('2020-01-01', '2020-01-02', '');
ok('periode tanpa data -> rows kosong', hKosong.rows.length === 0);
ok('periode kosong -> ringkasan nol', hKosong.ringkasan.total_laba === 0);

console.log('\n=== RINGKASAN ===');
console.log(`  ${pass} lulus, ${fail} gagal`);
process.exit(fail ? 1 : 0);
