/* Test filter jenis stok di Laporan > Stok Produk (Node + stub DOM).
 *
 * Memverifikasi:
 *  1. Dropdown #lp_jenis ada di HTML dengan 3 jenis + "Semua Jenis"
 *  2. Filter jenis: tabel & kartu statistik hanya berisi jenis terpilih
 *  3. Pilihan filter tersimpan di localStorage (tetap sama setelah reload)
 *  4. CSV & cetak ikut memakai filter
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  OK   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); }
}

function extract(name) {
  const start = js.indexOf('function ' + name + '(');
  if (start >= 0) {
    let i = js.indexOf('{', start), depth = 0;
    for (let j = i; j < js.length; j++) {
      if (js[j] === '{') depth++;
      else if (js[j] === '}') { depth--; if (depth === 0) return js.slice(start, j + 1); }
    }
  }
  const m = new RegExp('const\\s+' + name + '\\s*=\\s*(\\([^)]*\\)|[A-Za-z0-9_$]+)\\s*=>').exec(js);
  if (!m) throw new Error('fungsi tidak ditemukan: ' + name);
  const arrowPos = js.indexOf('=>', m.index);
  let i = js.indexOf('{', arrowPos);
  if (js[arrowPos + 2] !== '{') return js.slice(m.index, js.indexOf('\n', arrowPos));
  let depth = 0;
  for (let j = i; j < js.length; j++) {
    if (js[j] === '{') depth++;
    else if (js[j] === '}') { depth--; if (depth === 0) return js.slice(m.index, j + 1); }
  }
  throw new Error('body tidak tertutup: ' + name);
}

// ---------- stub DOM ----------
class El {
  constructor(id) { this.id = id; this.value = ''; this.textContent = ''; this.innerHTML = '';
    this.style = {}; this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false }; }
  addEventListener() {} setAttribute() {} focus() {} querySelectorAll() { return []; }
}
const els = {};
['lpStokBody', 'lpStItem', 'lpStHpp', 'lpStJual', 'lpStLow', 'lpStokCount', 'lp_jenis'].forEach(id => els[id] = new El(id));

// localStorage stub
const store = {};
const localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};

const SPARE = [
  { id: 1, nama: 'LCD Samsung A12', sku: 'LCD-1', merk: 'Samsung', kategori: 'LCD', jenis: 'Sparepart', hpp: 100000, harga_jual: 150000, stok: 2, stok_min: 1 },
  { id: 2, nama: 'Baterai Redmi', sku: 'BAT-1', merk: 'Xiaomi', kategori: 'Baterai', jenis: 'Sparepart', hpp: 65000, harga_jual: 95000, stok: 4, stok_min: 5 },
  { id: 3, nama: 'Tempered Glass', sku: 'ACC-1', merk: 'Generic', kategori: 'Aksesoris', jenis: 'Accessories', hpp: 8000, harga_jual: 20000, stok: 10, stok_min: 3 },
  { id: 4, nama: 'Nokia 105', sku: 'HP-1', merk: 'Nokia', kategori: 'Handphone', jenis: 'Handphone', hpp: 550000, harga_jual: 650000, stok: 6, stok_min: 2 },
];

function build() {
  const code = `
    const LS_LP_JENIS='servishp_lp_jenis_v1';
    ${extract('lpJenis')}
    ${extract('lpSetJenis')}
    ${extract('spJenis')}
    ${extract('renderStokLaporan')}
    return {lpJenis, lpSetJenis, renderStokLaporan};
  `;
  return new Function('SPARE', '$', 'esc', 'fmtRp', 'localStorage', code)(
    SPARE, (id) => els[id] || null, (s) => String(s ?? ''),
    (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID'), localStorage);
}

console.log('=== 1. Dropdown filter jenis ada di HTML ===');
ok('select #lp_jenis ada', html.includes('id="lp_jenis"'));
ok('opsi Semua Jenis', /id="lp_jenis"[\s\S]{0,400}?value="">Semua Jenis/.test(html));
ok('opsi Sparepart', /value="Sparepart"/.test(html));
ok('opsi Accessories', /value="Accessories"/.test(html));
ok('opsi Handphone', /value="Handphone"/.test(html));
ok('ada di area Laporan (di atas tabel Stok Produk)',
   html.indexOf('id="lp_jenis"') > html.indexOf('id="page-laporan"')
   && html.indexOf('id="lp_jenis"') < html.indexOf('id="lpStokBody"'));
ok('filter jenis menggantikan baris filter kasir',
   html.includes('id="lp_kasirRow"') && html.includes('id="lp_jenisRow"'));
ok('style .lp-filter ada di CSS', css.includes('.lp-filter'));

console.log('=== 2. Filter jenis benar-benar menyaring ===');
let api = build();
api.renderStokLaporan();
ok('tanpa filter: 4 item', els.lpStokCount.textContent === 4, String(els.lpStokCount.textContent));
ok('tanpa filter: tabel berisi semua jenis',
  els.lpStokBody.innerHTML.includes('LCD Samsung A12') && els.lpStokBody.innerHTML.includes('Tempered Glass')
  && els.lpStokBody.innerHTML.includes('Nokia 105'));
ok('tanpa filter: Total Item = 4', String(els.lpStItem.textContent) === '4', String(els.lpStItem.textContent));

api.lpSetJenis('Sparepart');
api.renderStokLaporan();
ok('filter Sparepart: 2 item', els.lpStokCount.textContent === 2, String(els.lpStokCount.textContent));
ok('filter Sparepart: tidak ada Accessories', !els.lpStokBody.innerHTML.includes('Tempered Glass'));
ok('filter Sparepart: tidak ada Handphone', !els.lpStokBody.innerHTML.includes('Nokia 105'));
ok('filter Sparepart: Total Item = 2', String(els.lpStItem.textContent) === '2');
// nilai HPP: LCD 100000*2 + BATT 65000*4 = 200000 + 260000 = 460000
ok('filter Sparepart: Nilai HPP = Rp 460.000', els.lpStHpp.textContent === 'Rp 460.000', String(els.lpStHpp.textContent));
// nilai jual: 150000*2 + 95000*4 = 300000 + 380000 = 680000
ok('filter Sparepart: Nilai Jual = Rp 680.000', els.lpStJual.textContent === 'Rp 680.000', String(els.lpStJual.textContent));
// menipis: LCD stok2<=min1? tidak; BATT 4<=5 ya -> 1
ok('filter Sparepart: Stok Menipis = 1', String(els.lpStLow.textContent) === '1', String(els.lpStLow.textContent));
ok('filter Sparepart: total row menyebut jenis', els.lpStokBody.innerHTML.includes('Total nilai stok (HPP) • Sparepart'));

api.lpSetJenis('Handphone');
api.renderStokLaporan();
ok('filter Handphone: 1 item', els.lpStokCount.textContent === 1, String(els.lpStokCount.textContent));
ok('filter Handphone: hanya Nokia', els.lpStokBody.innerHTML.includes('Nokia 105') && !els.lpStokBody.innerHTML.includes('LCD Samsung'));
ok('filter Handphone: Nilai HPP = Rp 3.300.000', els.lpStHpp.textContent === 'Rp 3.300.000', String(els.lpStHpp.textContent));

api.lpSetJenis('Accessories');
api.renderStokLaporan();
ok('filter Accessories: 1 item', els.lpStokCount.textContent === 1, String(els.lpStokCount.textContent));

api.lpSetJenis('');
api.renderStokLaporan();
ok('reset ke semua: 4 item lagi', els.lpStokCount.textContent === 4, String(els.lpStokCount.textContent));

console.log('=== 3. Filter tersimpan (tetap sama setelah reload) ===');
api.lpSetJenis('Sparepart');
ok('tersimpan di localStorage', localStorage.getItem('servishp_lp_jenis_v1') === 'Sparepart');
const api2 = build(); // simulasi reload
ok('setelah reload: filter = Sparepart', api2.lpJenis() === 'Sparepart', api2.lpJenis());
api2.renderStokLaporan();
ok('setelah reload: tabel 2 item', els.lpStokCount.textContent === 2, String(els.lpStokCount.textContent));

console.log('=== 4. CSV & cetak ikut filter ===');
ok('CSV pakai lpJenis()', /L\.push\('STOK'\+\(lpJenis\(\)/.test(js));
ok('CSV punya kolom Jenis', /'SKU,Nama,Merk,Kategori,Jenis,HPP,Jual,Stok,Nilai HPP'/.test(js));
ok('cetak pakai filter jenis', /const jenisF=lpJenis\(\);/.test(js) && /Stok\$\{jenisF\?/.test(js));

console.log('\n=== RINGKASAN ===');
console.log(`  ${pass} lulus, ${fail} gagal`);
process.exit(fail ? 1 : 0);
