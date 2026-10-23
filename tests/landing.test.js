const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const file = path.join(ROOT, 'landing', 'index.html');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  OK   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')); }
}

ok('file landing/index.html ada', fs.existsSync(file));

const html = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const jsonLd = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
let schema = null;
if (jsonLd) { try { schema = JSON.parse(jsonLd[1]); } catch (e) {} }

console.log('=== struktur & SEO ===');
ok('bahasa Indonesia', /<html lang="id">/.test(html));
ok('meta viewport', /name="viewport"/.test(html));
ok('judul Pitujaya Gadget', /<title>[^<]*Pitujaya Gadget[^<]*<\/title>/.test(html));
ok('meta description', /name="description" content="[^"]+"/.test(html));
ok('canonical pitujaya.my.id', /rel="canonical" href="https:\/\/pitujaya\.my\.id\/"/.test(html));
ok('Open Graph', /property="og:title"/.test(html) && /property="og:url"/.test(html));
ok('JSON-LD valid', !!schema);
ok('schema MobilePhoneStore', schema && schema['@type'] === 'MobilePhoneStore');
ok('schema nomor telepon', schema && schema.telephone === '+628985557579');
ok('schema alamat Ngawi', schema && schema.address && schema.address.addressLocality === 'Ngawi');

console.log('=== konten ===');
ok('section promo', /id="promo"/.test(html));
ok('section layanan', /id="layanan"/.test(html));
ok('section lokasi', /id="lokasi"/.test(html));
ok('promo LCD 10%', /Ganti LCD/.test(html) && /Diskon 10%/.test(html));
ok('promo baterai 15%', /Ganti Baterai/.test(html) && /Diskon 15%/.test(html));
ok('promo HP mulai 1 jutaan', /Mulai 1 jutaan/.test(html));
ok('alamat toko', /Jl\. Teuku Umar Barat No\. 25/.test(html));
ok('link Google Maps', /google\.com\/maps/.test(html));

console.log('=== promo APK POS ===');
ok('section aplikasi POS', /id="pos"/.test(html));
ok('section form daftar', /id="daftar"/.test(html));
ok('link download APK', /href="\/download\/pitujaya-pos\.apk"/.test(html));
ok('atribut download APK', /download="Pitujaya-POS\.apk"/.test(html));
ok('form daftar minat', /id="leadForm"/.test(html));
ok('field nama + WhatsApp', /name="nama"/.test(html) && /name="hp"/.test(html));
ok('field konter + email', /name="konter"/.test(html) && /name="email"/.test(html));
ok('honeypot anti-bot', /name="website"/.test(html) && /class="hp-field"/.test(html));
ok('kirim ke endpoint leads', /fetch\("\/api\/leads"/.test(html));
ok('tidak membuat akun kasir publik', !/\/api\/auth\/register/.test(html));
const apkFile = path.join(ROOT, 'landing', 'download', 'pitujaya-pos.apk');
const apkOk = fs.existsSync(apkFile) && fs.statSync(apkFile).size > 1000000;
ok('file APK tersedia (>1 MB)', apkOk, apkOk ? '' : 'file tidak ada / terlalu kecil');

console.log('=== WhatsApp & mandiri ===');
const waLinks = (html.match(/https:\/\/wa\.me\/628985557579/g) || []).length;
ok('nomor WA benar di semua tombol', waLinks >= 6, String(waLinks));
ok('pesan WhatsApp otomatis', /data-message="/.test(html) && /encodeURIComponent/.test(html));
ok('tanpa aset gambar eksternal', !/<img\s/.test(html));
ok('tanpa stylesheet eksternal', !/<link[^>]+rel="stylesheet"/.test(html));
ok('tanpa script eksternal', !/<script[^>]+src=/.test(html));
ok('tanpa link placeholder #', !/href="#"/.test(html));

console.log('\n=== RINGKASAN ===');
console.log(`  ${pass} lulus, ${fail} gagal`);
process.exit(fail ? 1 : 0);
