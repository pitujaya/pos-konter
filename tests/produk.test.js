/* Test DOM halaman Produk (Node + stub DOM minimal).
 *
 * Memverifikasi:
 *  1. Klik sub-menu jenis -> hanya barang jenis itu yang tampil di tabel
 *  2. Tombol "Input Produk Baru" ada di ATAS (bar sticky), bukan di bawah
 *  3. Label jenis aktif tampil di subjudul
 *  4. Dropdown kategori hanya berisi kategori dari jenis aktif
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const js = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

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

// ================= STUB DOM =================
class El {
  constructor(id, tag) { this.id = id; this.tag = tag || 'div'; this.value = ''; this.textContent = '';
    this.innerHTML = ''; this.style = {}; this.classList = makeClassList(); this.children = []; this.hidden = false; }
  addEventListener() {} setAttribute() {} removeAttribute() {}
  getAttribute() { return null; } focus() {}
  insertAdjacentHTML(p, h) { this.innerHTML += h; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  closest() { return null; }
}
function makeClassList() {
  const s = new Set();
  return {
    add: (...c) => c.forEach(x => s.add(x)),
    remove: (...c) => c.forEach(x => s.delete(x)),
    toggle: (c, on) => { if (on === undefined) { s.has(c) ? s.delete(c) : s.add(c); } else if (on) s.add(c); else s.delete(c); },
    contains: c => s.has(c),
    _set: s,
  };
}
const els = {};
function mk(id, tag) { els[id] = new El(id, tag); return els[id]; }
['spTable', 'spTotal', 'spNilai', 'spLow', 'spCount', 'spInfo', 'spJenisLabel', 'spSubtitle',
 'emptySpare', 'spSearch', 'spKategori', 'spSort', 'spLowBtn', 'btnAddSpare', 'prTabs'].forEach(id => mk(id));

// spSearch & spKategori & spSortdefault values
els.spSearch.value = '';
els.spKategori.value = '';
els.spSort.value = 'nama';

const SPARE = [
  { id: 1, nama: 'LCD Samsung A12', sku: 'LCD-1', merk: 'Samsung', kategori: 'LCD', jenis: 'Sparepart', hpp: 180000, harga_jual: 250000, stok: 8, stok_min: 3 },
  { id: 2, nama: 'Baterai Redmi', sku: 'BAT-1', merk: 'Xiaomi', kategori: 'Baterai', jenis: 'Sparepart', hpp: 65000, harga_jual: 95000, stok: 2, stok_min: 5 },
  { id: 3, nama: 'Tempered Glass', sku: 'ACC-1', merk: 'Generic', kategori: 'Aksesoris', jenis: 'Accessories', hpp: 8000, harga_jual: 20000, stok: 40, stok_min: 10 },
  { id: 4, nama: 'Case Silikon', sku: 'ACC-2', merk: 'Generic', kategori: 'Aksesoris', jenis: 'Accessories', hpp: 12000, harga_jual: 30000, stok: 25, stok_min: 8 },
  { id: 5, nama: 'Nokia 105', sku: 'HP-1', merk: 'Nokia', kategori: 'Handphone', jenis: 'Handphone', hpp: 550000, harga_jual: 650000, stok: 6, stok_min: 2 },
  { id: 6, nama: 'Infinix Hot 30', sku: 'HP-2', merk: 'Infinix', kategori: 'Handphone', jenis: 'Handphone', hpp: 1350000, harga_jual: 1550000, stok: 4, stok_min: 2 },
];
const JENIS_PRODUK = ['Sparepart', 'Accessories', 'Handphone'];
const PR_TABS = { sparepart: 'Sparepart', accessories: 'Accessories', handphone: 'Handphone' };

const sandbox = new Function(
  'SPARE', 'JENIS_PRODUK', 'PR_TABS', '$', 'esc', 'fmtRp', 'isAdminUp', 'spMargin',
  extract('spKat') + '\n' + extract('spJenis') + '\n' + extract('spJenisAktif') + '\n' +
  extract('spKategoriList') + '\n' + extract('refreshSpKategoriUI') + '\n' +
  extract('renderSpareparts') + '\n' +
  'return {spJenis, spJenisAktif, spKategoriList, refreshSpKategoriUI, renderSpareparts};'
);
const api = sandbox(SPARE, JENIS_PRODUK, PR_TABS, (id) => els[id] || null,
  (s) => String(s ?? ''), (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID'),
  () => true, (x) => '+10%');

// helper: set tab aktif lalu render
function renderWithTab(tab) {
  // emulate gotoProdukTab: set prTab via PR_TABS
  const fn = new Function('PR_TABS', 'tab', 'return PR_TABS[tab] ? tab : "sparepart"');
  // prTab adalah variabel closure di script.js; emulate dengan evaluating spJenisAktif
  // cara sederhana: tulis ke sandbox lewat spJenisAktif -> kita paksa dengan mengganti PR_TABS?-
  // lebih aman: emulate dengan monkey patch tidak bisa; gunakan pendekatan render langsung
  // -> Kita panggil renderSpareparts setelah mengatur PR_TABS global? tidak.
  return null;
}

// Karena prTab & prTab adalah lexical, kita buat ulang fungsi render dengan tab tertentu
function renderFor(tab) {
  const code = `
    let prTab=${JSON.stringify(tab)};
    let spLowOnly=false;
    ${extract('spKat')}
    const JENIS_PRODUK=${JSON.stringify(JENIS_PRODUK)};
    const PR_TABS=${JSON.stringify(PR_TABS)};
    ${extract('spJenis')}
    ${extract('spJenisAktif')}
    ${extract('spKategoriList')}
    ${extract('refreshSpKategoriUI')}
    ${extract('renderSpareparts')}
    renderSpareparts();
  `;
  const run = new Function('SPARE', '$', 'esc', 'fmtRp', 'isAdminUp', 'spMargin', 'jsStr', code);
  run(SPARE, (id) => els[id] || null, (s) => String(s ?? ''),
    (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID'), () => true, (x) => '+10%',
    (v) => String(v));
  return els.spTable.innerHTML;
}

console.log('=== 1. Tabel hanya berisi jenis tab yang diklik ===');
let h = renderFor('sparepart');
ok('Sparepart: 2 item, tanpa ACC/HP', h.includes('LCD Samsung A12') && h.includes('Baterai Redmi')
   && !h.includes('Tempered Glass') && !h.includes('Nokia 105'), h.replace(/<[^>]+>/g, '|').slice(0, 140));
ok('Sparepart: 2 baris', (h.match(/<tr>/g) || []).length === 2, String((h.match(/<tr>/g) || []).length));

h = renderFor('accessories');
ok('Accessories: 2 item, tanpa Sparepart/HP', h.includes('Tempered Glass') && h.includes('Case Silikon')
   && !h.includes('LCD Samsung A12') && !h.includes('Nokia 105'), h.replace(/<[^>]+>/g, '|').slice(0, 140));
ok('Accessories: 2 baris', (h.match(/<tr>/g) || []).length === 2);

h = renderFor('handphone');
ok('Handphone: 2 item, tanpa Sparepart/Acc', h.includes('Nokia 105') && h.includes('Infinix Hot 30')
   && !h.includes('LCD Samsung A12') && !h.includes('Tempered Glass'), h.replace(/<[^>]+>/g, '|').slice(0, 140));
ok('Handphone: 2 baris', (h.match(/<tr>/g) || []).length === 2);

console.log('=== 2. Statistik & label hanya untuk jenis aktif ===');
renderFor('accessories');
ok('spTotal = 2 (hanya Accessories)', els.spTotal.textContent === 2, String(els.spTotal.textContent));
ok('spCount = "2 item"', els.spCount.textContent === '2 item', String(els.spCount.textContent));
ok('label jenis aktif = Stok Accessories', els.spJenisLabel.textContent === '🎧 Stok Accessories', String(els.spJenisLabel.textContent));
renderFor('handphone');
ok('spTotal = 2 (Handphone)', els.spTotal.textContent === 2, String(els.spTotal.textContent));
ok('label jenis aktif = Stok Handphone', els.spJenisLabel.textContent === '📱 Stok Handphone', String(els.spJenisLabel.textContent));
renderFor('sparepart');
ok('label jenis aktif = Stok Sparepart', els.spJenisLabel.textContent === '🔧 Stok Sparepart', String(els.spJenisLabel.textContent));

console.log('=== 3. Dropdown kategori hanya kategori jenis aktif ===');
renderFor('accessories');
ok('kategori accessories', els.spKategori.innerHTML.includes('Aksesoris'), els.spKategori.innerHTML);
ok('kategori tidak ada LCD (sparepart)', !els.spKategori.innerHTML.includes('>LCD<'), els.spKategori.innerHTML);
ok('kategori tidak ada Handphone', !els.spKategori.innerHTML.includes('>Handphone<'), els.spKategori.innerHTML);

console.log('=== 4. Tombol Input Produk Baru di ATAS (bukan bawah) ===');
const idxBar = html.indexOf('id="prBar"');
const idxBtn = html.indexOf('id="btnAddSpare"');
const idxTable = html.indexOf('id="spTable"');
ok('bar produk ada di HTML', idxBar > 0);
ok('tombol Input Produk Baru ada', idxBtn > 0);
ok('tombol BEFORE tabel (di atas)', idxBtn < idxTable, `btn=${idxBtn} table=${idxTable}`);
ok('tombol berada DI DALAM bar sticky', (() => {
  const barStart = html.indexOf('id="prBar"');
  const barEnd = html.indexOf('class="stats lp-stats lp-stats-3"', barStart);
  const seg = html.slice(barStart, barEnd);
  return seg.includes('id="btnAddSpare"');
})(), 'tombol harus di dalam blok .produk-bar sebelum blok stats');
ok('tombol bawah sudah DIHAPUS', !html.includes('btnAddSpareBottom'));
ok('bar produk sticky di CSS', /\.produk-bar\{[^}]*position:sticky/.test(fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8')));
ok('script.js tidak lagi pakai btnAddSpareBottom', !js.includes('btnAddSpareBottom'));

console.log('\n=== RINGKASAN ===');
console.log(`  ${pass} lulus, ${fail} gagal`);
process.exit(fail ? 1 : 0);
