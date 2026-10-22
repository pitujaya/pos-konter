// ===== ServisHP Pro - Management Service HP =====
const LS_DATA = 'servishp_data_v1';
const LS_SET = 'servishp_setting_v1';
const LS_USERS = 'servishp_users_v1';
const LS_SESSION = 'servishp_session_v1';

// ===== BACKEND FastAPI (otomatis, fallback LocalStorage) =====
let BACKEND_OK = false;
let ME_CACHE = null;
function backendBase(){ try{ return (window.API && window.API.base) || 'http://127.0.0.1:8000/api'; }catch{ return 'http://127.0.0.1:8000/api'; } }
function backendToken(){ try{ return (window.API && window.API.getToken()) || null; }catch{ return null; } }
function setBackendStatus(msg){ const el=document.getElementById('backendStatus'); if(el) el.textContent=msg; const inp=document.getElementById('s_apiBase'); if(inp && !inp.value) inp.value=backendBase(); }
async function checkBackend(silent){
  if(!window.API){ BACKEND_OK=false; if(!silent) setBackendStatus('🔴 offline (api.js tidak dimuat)'); return false; }
  try{
    // Coba base aktif dulu; bila gagal, auto-coba kandidat lain (Ubuntu IP/domain, dsb.)
    try {
      await window.API.health();
    } catch (e1) {
      if (window.API.autoConnect) {
        const found = await window.API.autoConnect(3500);
        if (!found) throw e1;
        await window.API.health();
      } else throw e1;
    }
    BACKEND_OK=true;
    setBackendStatus('🟢 tersambung ('+backendBase()+')');
    return true;
  }catch(e){
    BACKEND_OK=false;
    const hint = (window.API && window.API.candidates) ? ' • coba: ' + window.API.candidates().join(' | ') : '';
    if(!silent) setBackendStatus('🔴 offline — pakai LocalStorage ('+backendBase()+')' + (silent ? '' : hint));
    else setBackendStatus('🔴 offline — pakai LocalStorage');
    return false;
  }
}
function useBackend(){ return BACKEND_OK && !!backendToken() && !!window.API; }
async function pullServices(){
  if(!useBackend()) return false;
  try{
    const list = await window.API.listServices({limit:1000, sort:'baru'});
    DB = Array.isArray(list) ? list : [];
    DB.forEach(x=>{ x.status=normStatus(x.status); if(Array.isArray(x.riwayat)) x.riwayat.forEach(r=>{ r.s=normStatus(r.s); }); });
    try{ localStorage.setItem(LS_DATA, JSON.stringify(DB)); }catch{}
    return true;
  }catch(e){ console.warn('pullServices gagal:', e.message); return false; }
}
async function pullSettings(){
  if(!useBackend()) return false;
  try{
    const s = await window.API.getSettings();
    SET = { nama:s.nama, alamat:s.alamat, telp:s.telp, nota:s.nota, teknisi:s.teknisi||[], merk:s.merk||[] };
    try{ localStorage.setItem(LS_SET, JSON.stringify(SET)); }catch{}
    return true;
  }catch(e){ console.warn('pullSettings gagal:', e.message); return false; }
}
async function refreshFromBackend(){ await pullServices(); await pullSettings(); await pullSlides(); await pullSpareparts(); try{ await pullSales(); }catch{} try{ await pullExpenses(); }catch{} }
async function pullSlides(){
  if(!useBackend()) return false;
  try{
    // Ambil SEMUA slide (aktif + nonaktif) supaya slide yang dimatikan tetap
    // terlihat di Kelola Slide dan bisa diaktifkan lagi. Endpoint /slides/all
    // khusus admin; kasir cukup dapat slide aktif saja.
    let list = null;
    if(isAdminUp() && window.API.listAllSlides){
      try{ list = await window.API.listAllSlides(); }catch(e){ list = null; }
    }
    if(!list) list = await window.API.listSlides();
    SLIDES = Array.isArray(list) ? list : [];
    saveSlidesLocal(); renderHeadbar(); renderSlideManager();
    return true;
  }catch(e){ console.warn('pullSlides gagal:', e.message); return false; }
}
function fullImageUrl(u){
  if(!u) return '';
  if(/^https?:\/\//i.test(u) || u.startsWith('data:')) return u;
  if(u.startsWith('/')) return backendBase().replace(/\/api$/, '') + u;
  return u;
}

// ===== AUTH (email atau no HP) =====
const normEmail = (s)=>String(s||'').trim().toLowerCase();
const normPhone = (s)=>String(s||'').replace(/[\s\-().]/g,'').replace(/^\+62/,'0');
const isEmail = (s)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s||'').trim());
const hashPw = (s)=>{ let h=5381; const str='svhp$'+s; for(let i=0;i<str.length;i++){ h=((h<<5)+h+str.charCodeAt(i))|0; } return 'h'+(h>>>0).toString(36); };
function loadUsers(){ try{ return JSON.parse(localStorage.getItem(LS_USERS))||[]; }catch{ return []; } }
function saveUsers(u){ localStorage.setItem(LS_USERS, JSON.stringify(u)); }
function getSession(){ try{ return JSON.parse(localStorage.getItem(LS_SESSION)||sessionStorage.getItem(LS_SESSION))||null; }catch{ return null; } }
function setSession(userId, remember){
  const s=JSON.stringify({uid:userId, t:Date.now()});
  if(remember){ localStorage.setItem(LS_SESSION,s); sessionStorage.removeItem(LS_SESSION); }
  else{ sessionStorage.setItem(LS_SESSION,s); localStorage.removeItem(LS_SESSION); }
}
function clearSession(){
  localStorage.removeItem(LS_SESSION); sessionStorage.removeItem(LS_SESSION);
  try{ if(window.API) window.API.clearToken(); }catch{}
  // Beri tahu shell Android (APK) supaya token native ikut dihapus.
  // Tanpa ini, token tetap tersimpan di SharedPreferences dan user
  // otomatis login lagi saat aplikasi dibuka berikutnya -> logout tidak efek.
  try{ if(window.AndroidAuth && typeof window.AndroidAuth.onLogout==='function') window.AndroidAuth.onLogout(); }catch{}
  ME_CACHE=null; BACKEND_OK=BACKEND_OK; // token dihapus, status koneksi tetap
}
function currentUser(){
  if(ME_CACHE) return ME_CACHE;
  const s=getSession(); if(!s) return null;
  return loadUsers().find(u=>u.id===s.uid)||null;
}
// ===== ROLES: kasir < admin < superadmin =====
const ROLES = { kasir:{label:'Kasir',icon:'🧾'}, admin:{label:'Admin',icon:'🛠'}, superadmin:{label:'Super Admin',icon:'👑'} };
const roleLabel = (r)=> (ROLES[r]? ROLES[r].icon+' '+ROLES[r].label : r||'-');
const roleBadge = (r)=> `<span class="role-badge role-${r}">${esc(roleLabel(r))}</span>`;
function myRole(){ const u=currentUser(); return u ? (u.role||'kasir') : 'kasir'; }
function isSuperAdmin(){ return myRole()==='superadmin'; }
function isAdminUp(){ return myRole()==='admin'||isSuperAdmin(); }
function needAdmin(){ if(!isAdminUp()){ toast('⛔ Khusus Admin / Super Admin'); return false; } return true; }
function needSuperAdmin(){ if(!isSuperAdmin()){ toast('⛔ Khusus Super Admin'); return false; } return true; }
// seed akun demo (3 role)
(function seedAdmin(){
  let users=loadUsers();
  let changed=false;
  const ensure=(nama,email,hp,pw,role)=>{
    const exists=users.some(x=>normEmail(x.email)===normEmail(email));
    if(!exists){ users.push({id:Date.now()+Math.floor(Math.random()*1e6), nama, email, hp, pw:hashPw(pw), role, created:new Date().toISOString()}); changed=true; }
  };
  // migrasi: user lama tanpa role -> superadmin pertama, sisanya kasir
  users.forEach((u,i)=>{ if(!u.role){ u.role = i===0 ? 'superadmin' : 'kasir'; changed=true; } });
  ensure('Super Admin','admin@konter.id','081234567890','admin123','superadmin');
  ensure('Admin Toko','admin.toko@konter.id','081234567891','admin123','admin');
  ensure('Kasir Toko','kasir.toko@konter.id','081234567892','kasir123','kasir');
  if(changed||!localStorage.getItem(LS_USERS)) saveUsers(users);
})();
function applyRoleUI(){
  const r=myRole();
  const navP=$('navPengaturan'), navU=$('navPengguna');
  const gp=navP?navP.closest('.nav-group'):null, gu=navU?navU.closest('.nav-group'):null;
  if(gp) gp.style.display = (r==='kasir') ? 'none' : '';
  if(gu) gu.style.display = isSuperAdmin() ? '' : 'none';
  const lock=$('penggunaLock'), wrap=$('penggunaWrap');
  if(lock&&wrap){ lock.classList.toggle('hidden', isSuperAdmin()); wrap.classList.toggle('hidden', !isSuperAdmin()); }
}
function showApp(user){
  ME_CACHE = user;
  $('authScreen').classList.add('hidden');
  $('mainApp').classList.remove('hidden');
  const role=user.role||'kasir';
  // Kompatibilitas: user-chip topbar sudah dipindah ke sidebar, jaga kalau elemen lama masih ada
  if($('userName')) $('userName').textContent=String(user.nama||'-').split(' ')[0];
  if($('userRole')){ $('userRole').textContent=roleLabel(role); $('userRole').className='role-badge role-'+role; }
  if($('sideUser')) $('sideUser').textContent=user.nama||'-';
  if($('sideUserRole')){ $('sideUserRole').textContent=roleLabel(role); $('sideUserRole').className='role-badge role-'+role; }
  if($('sideUserId')) $('sideUserId').textContent=(user.email||'')+(user.email&&user.hp?' • ':'')+(user.hp||'');
  if($('sideAvatar')) $('sideAvatar').textContent=String(user.nama||'👤').trim().charAt(0).toUpperCase()||'👤';
  $('accNama').textContent=user.nama; $('accRole').textContent=roleLabel(role); $('accEmail').textContent=user.email||'-'; $('accHp').textContent=user.hp||'-';
  try{ var bn=$('bottomNav'); if(bn&&bn.parentNode) bn.parentNode.removeChild(bn); }catch{}
  applyRoleUI(); renderUsers();
  try{ syncSesi(); }catch(e){ console.warn('syncSesi:', e); }
}
function showAuth(){
  $('authScreen').classList.remove('hidden');
  $('mainApp').classList.add('hidden');
  try{ var bn2=$('bottomNav'); if(bn2&&bn2.parentNode) bn2.parentNode.removeChild(bn2); }catch{}
  const ov=$('sidebarOverlay'); if(ov) ov.classList.remove('show');
  const sb=$('sidebar'); if(sb) sb.classList.remove('open');
}
function doLogout(){ clearSession(); KAS=null; try{ renderKasUI(); }catch{} showAuth(); toast('Berhasil keluar 👋'); }

const $ = (id) => document.getElementById(id);
// helper aman: ambil value walau elemen sudah dihapus (DP/IMEI/Warna)
const val = (id, def='') => { const el = document.getElementById(id); return el ? el.value : def; };
const fmtRp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const fmtTgl = (s) => { if(!s) return '-'; try{ const d=new Date(s); return d.toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'});}catch{return s;} };
const STATUS = ['Dikerjakan','Selesai','Diambil','Cancel'];
// Migrasi status lama -> baru (Antri/Menunggu Sparepart -> Dikerjakan, Batal -> Cancel)
function normStatus(s){
  s = String(s||'').trim();
  if(s==='Antri' || s==='Menunggu Sparepart') return 'Dikerjakan';
  if(s==='Batal') return 'Cancel';
  if(STATUS.includes(s)) return s;
  return 'Dikerjakan';
}

let DB = loadData();
// Normalisasi sekali saat aplikasi dimuat agar data lama ikut aturan baru
(function migrateLocalStatus(){
  try{
    let changed=false;
    DB.forEach(x=>{
      const ns=normStatus(x.status);
      if(x.status!==ns){ x.status=ns; changed=true; }
      if(Array.isArray(x.riwayat)) x.riwayat.forEach(r=>{ const rs=normStatus(r.s); if(r.s!==rs){ r.s=rs; changed=true; } });
    });
    if(changed) saveData();
  }catch{}
})();
let SET = loadSetting();
const LS_SLIDES = 'servishp_slides_v1';
let SLIDES = loadSlidesLocal();
let headIdx = 0;
let headTimer = null;

function loadSlidesLocal(){ try{ return JSON.parse(localStorage.getItem(LS_SLIDES)) || []; }catch{ return []; } }
function saveSlidesLocal(){ try{ localStorage.setItem(LS_SLIDES, JSON.stringify(SLIDES)); }catch{} }
if(!SLIDES.length){
  SLIDES=[
    {id:1, judul:'Servis HP Cepat & Bergaransi', subjudul:'LCD • Baterai • Software — estimasi jelas, nota otomatis', image_url:'', urutan:0, aktif:true},
    {id:2, judul:'Promo Ganti LCD Hari Ini', subjudul:'Gratis tempered glass untuk 10 pelanggan pertama', image_url:'', urutan:1, aktif:true},
  ];
}
let activeFilter = 'Semua';
let editId = null;

function loadData(){ try{ return JSON.parse(localStorage.getItem(LS_DATA)) || []; }catch{ return []; } }
function saveData(){ localStorage.setItem(LS_DATA, JSON.stringify(DB)); }
function loadSetting(){
  try{
    return JSON.parse(localStorage.getItem(LS_SET)) || {
      nama:'ServisHP Pro - POS Konter', alamat:'Jl. Merdeka No. 1, Kota Anda',
      telp:'08xx-xxxx-xxxx', nota:'Garansi 7 hari untuk service yang sama. Barang yang tidak diambil >30 hari bukan tanggung jawab kami.',
      teknisi:['Andi','Budi'], merk:['Samsung','iPhone','Xiaomi','Oppo','Vivo','Realme','Infinix']
    };
  }catch{
    return { nama:'ServisHP Pro', alamat:'-', telp:'-', nota:'', teknisi:['Teknisi 1'], merk:['Samsung','Xiaomi'] };
  }
}
function saveSetting(){ localStorage.setItem(LS_SET, JSON.stringify(SET)); }

function waNumber(telp){
  let d=String(telp||'').replace(/\D/g,'');
  if(!d) return '';
  if(d.startsWith('0')) d='62'+d.slice(1);
  else if(d.startsWith('62')) d=d;
  else if(d.startsWith('8')) d='62'+d;
  return d;
}
function waHref(x){
  const n=waNumber(x.telp);
  if(!n || n.length<10 || n.length>15) return '';
  const msg=`Halo ${x.nama||'kak'}, ini dari ${(typeof SET!=='undefined'&&SET.nama)||'konter kami'}. Update service ${x.noService||''} (${x.merk||''} ${x.tipe||''}): status *${normStatus(x.status)}*, biaya ${fmtRp(x.biaya)}. Terima kasih 🙏`;
  return `https://wa.me/${n}?text=${encodeURIComponent(msg)}`;
}
// Pesan "service sudah selesai & siap diambil". Dipakai saat status -> Diambil.
function waPesanAmbil(x){
  const toko=(typeof SET!=='undefined'&&SET.nama)||'konter kami';
  const nama=x.nama||'kak';
  const device=[x.merk,x.tipe].filter(Boolean).join(' ');
  const l1=`Halo ${nama}, ini dari ${toko}. 🙏`;
  const l2=`Unit ${device||'HP Anda'} (${x.noService||''}) sudah selesai dan siap diambil.`;
  const l3=`Keluhan: ${String(x.keluhan||'-').slice(0,80)}`;
  const l4=`Total biaya: *${fmtRp(x.biaya)}*`;
  const l5=`Silakan datang ke ${toko} untuk ambil & cek unit Anda.`;
  return [l1,l2,l3,l4,l5].join('\n');
}
function waHrefAmbil(x){
  const n=waNumber(x.telp);
  if(!n || n.length<10 || n.length>15) return '';
  return `https://wa.me/${n}?text=${encodeURIComponent(waPesanAmbil(x))}`;
}
// APK WebView: link wa.me / whatsapp:// harus dibuka via Intent native (bukan di WebView),
// kalau tidak -> net::ERR_UNKNOWN_URL_SCHEME. Delegasi global untuk semua tombol .wa-btn.
document.addEventListener('click', function(e){
  try{
    const a=(e.target && e.target.closest) ? e.target.closest('a.wa-btn') : null;
    if(!a || !a.href) return;
    if(window.AndroidBT && typeof window.AndroidBT.openExternal==='function'){
      e.preventDefault();
      window.AndroidBT.openExternal(a.href);
    }
  }catch{}
});
// Mobile: saat keyboard dibuka, pastikan input yg difokus ikut terlihat (geser ke tengah layar).
// Tanpa ini, keyboard menutupi field/tombol di bawahnya dan pengguna merasa "tidak bisa scroll".
document.addEventListener('focusin', function(e){
  try{
    if(!(window.matchMedia && window.matchMedia('(max-width:760px)').matches)) return;
    const t=e.target;
    if(!t||!t.tagName) return;
    const tag=String(t.tagName).toUpperCase();
    if(tag!=='INPUT'&&tag!=='TEXTAREA'&&tag!=='SELECT') return;
    const tp=String(t.type||'').toLowerCase();
    if(tp==='checkbox'||tp==='radio'||tp==='file'||tp==='button'||tp==='submit'||tp==='hidden') return;
    setTimeout(()=>{ try{ t.scrollIntoView({block:'center', behavior:'smooth'}); }catch{ try{ t.scrollIntoView(); }catch{} } }, 350);
  }catch{}
});
function toast(msg, ms){ const t=document.createElement('div'); t.className='toast'; t.textContent=msg; $('toastWrap').appendChild(t); setTimeout(()=>t.remove(), ms||2500); }
function esc(s){ return String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
// Sanitasi URL untuk dipakai di href/src. Skema javascript:/data:/vbscript: bisa
// menjalankan skrip di origin aplikasi (XSS) -> dibuang jadi string kosong.
// Parameter allowDataImage mengizinkan data:image/... (dipakai slide offline).
function safeUrl(u, allowDataImage){
  const v=String(u??'').trim();
  if(!v) return '';
  const low=v.toLowerCase().replace(/[\u0000-\u0020]/g,'');
  if(low.startsWith('javascript:')||low.startsWith('vbscript:')||low.startsWith('file:')) return '';
  if(low.startsWith('data:') && !(allowDataImage && /^data:image\//i.test(v))) return '';
  return v;
}
// Escape URL untuk dipakai di dalam context CSS (url("...")).
function cssUrl(u){ return String(u??'').replace(/["'()\\;]/g, ch=>'\\'+ch); }
// Escape untuk NILAI string di dalam konteks JavaScript yang disisipkan ke
// atribut HTML (onclick="fn('...')"). esc() tidak cukup: ia mengubah ' jadi
// &#39; yang lalu di-decode lagi oleh parser HTML sebelum JS-nya dieksekusi,
// sehingga string literal bisa pecah. Fungsi ini aman untuk kedua konteks.
function jsStr(v){
  return JSON.stringify(String(v??'')).slice(1,-1)
    .replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026')
    .replace(/'/g,'\\u0027').replace(/"/g,'\\u0022');
}
function badge(st){ st = normStatus(st || 'Dikerjakan'); return `<span class="badge b-${String(st).replace(/ /g,'-')}">${esc(st)}</span>`; }

// ===== SESI KASIR (buka / tutup shift) =====
// Satu sesi terbuka per kasir. Input service/penjualan/pengeluaran DITOLAK
// selama belum buka sesi (guard frontend + backend 409).
const LS_KAS = 'servishp_kas_v1';
const PAGES_TRANSAKSI = ['tambah', 'penjualan', 'pengeluaran']; // menu yang butuh sesi kasir
let KAS = null;          // sesi terbuka milik user aktif (null = kas tutup)
let KAS_RIWAYAT = [];    // riwayat sesi untuk modal

function loadKasLocal(){ try{ return JSON.parse(localStorage.getItem(LS_KAS)) || []; }catch{ return []; } }
function saveKasLocal(list){ try{ localStorage.setItem(LS_KAS, JSON.stringify(list || KAS_RIWAYAT)); }catch{} }
function parseTs(s){
  if(!s) return 0;
  let str = String(s).trim().replace(' ', 'T');
  // timestamp backend (datetime naive, disimpan UTC) -> paksa UTC agar tidak geser zona
  if(!/(Z|[+-]\d{2}:?\d{2})$/.test(str)) str += 'Z';
  const t = Date.parse(str);
  return isNaN(t) ? 0 : t;
}
function tsRecord(x){
  if(!x) return 0;
  if(x.created_at){ const t = parseTs(x.created_at); if(t) return t; }
  const id = Number(x.id) || 0;
  if(id > 1e12) return id;                       // id lokal = Date.now()
  if(x.tanggal){ const t = Date.parse(String(x.tanggal).slice(0,10) + 'T00:00:00Z'); if(!isNaN(t)) return t; }
  return 0;
}
function fmtJam(iso){
  const t = parseTs(iso); if(!t) return '-';
  return new Date(t).toLocaleString('id-ID', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'});
}
function tunaiMetode(m){ m = String(m||'').trim().toLowerCase(); return m==='' || m==='tunai' || m==='cash'; }
function kasCache(sess){
  if(!sess) return null;
  try{
    const list = loadKasLocal().filter(x => String(x.id) !== String(sess.id));
    list.unshift(sess);
    saveKasLocal(list.slice(0, 60));
  }catch{}
  return sess;
}
function kasOpenLocal(){
  const me = currentUser(); if(!me) return null;
  return loadKasLocal().find(x => x.status === 'open' && (String(x.user_id) === String(me.id) || x.kasir === me.nama)) || null;
}
function kasSesiAktif(){ return !!(KAS && KAS.status === 'open'); }

async function syncSesi(){
  try{
    if(useBackend()){
      const s = await window.API.kasCurrent();
      KAS = s || null;
      if(KAS) kasCache(KAS);
    } else {
      KAS = kasOpenLocal();
    }
  }catch(e){
    console.warn('syncSesi gagal:', e.message);
    KAS = kasOpenLocal();
  }
  renderKasUI();
  return KAS;
}

// Rekap kas mode offline (isinya sama dengan backend: rentang waktu sesi)
function kasSummaryLocal(sess){
  const t0 = parseTs(sess.opened_at);
  const t1 = sess.closed_at ? parseTs(sess.closed_at) : Date.now();
  const inWin = (t) => t >= t0 && t <= t1;
  const kasir = String(sess.kasir || '');
  const sales = (typeof SALES !== 'undefined' ? SALES : []).filter(s =>
    inWin(tsRecord(s)) && (!kasir || String(s.kasir || '') === kasir));
  const expenses = (typeof EXPENSES !== 'undefined' ? EXPENSES : []).filter(e =>
    inWin(tsRecord(e)) && (!kasir || String(e.dicatat_oleh || '') === kasir));
  // service: tanpa kolom kasir -> pakai waktu status Diambil (riwayat)
  const services = (typeof DB !== 'undefined' ? DB : []).filter(sv =>
    Array.isArray(sv.riwayat) && sv.riwayat.some(h => h.s === 'Diambil' && inWin(parseTs(h.t))));
  const penjualanTotal = sales.reduce((a, s) => a + Number(s.total || 0), 0);
  const tunai = sales.filter(s => tunaiMetode(s.metode)).reduce((a, s) => a + Number(s.total || 0), 0);
  const pengeluaran = expenses.reduce((a, e) => a + Number(e.jumlah || 0), 0);
  const serviceOmzet = services.reduce((a, s) => a + Number(s.biaya || 0), 0);
  return {
    jml_transaksi: sales.length + expenses.length + services.length,
    penjualan_count: sales.length,
    penjualan_total: penjualanTotal,
    tunai_masuk: tunai,
    non_tunai: penjualanTotal - tunai,
    pengeluaran_total: pengeluaran,
    service_count: services.length,
    service_omzet: serviceOmzet,
    kas_sistem: Number(sess.modal_awal || 0) + tunai - pengeluaran,
  };
}

function renderKasUI(){
  try{
    const p = $('kasPill'); if(!p) return;
    if(!currentUser()){ p.classList.add('hidden-when-auth'); return; }
    p.classList.remove('hidden-when-auth');
    if(!useBackend() && kasSesiAktif()) Object.assign(KAS, kasSummaryLocal(KAS));
    const open = kasSesiAktif();
    p.classList.toggle('open', open);
    p.classList.toggle('closed', !open);
    p.innerHTML = open
      ? '🔓 <span class="kas-txt">Kas Terbuka</span><span class="kas-amt"> • ' + fmtRp(KAS.kas_sistem || KAS.modal_awal || 0) + '</span>'
      : '🔒 <span class="kas-txt">Kas Tutup</span>';
    p.title = open
      ? ('Sesi #' + (KAS.id || '-') + ' • ' + (KAS.kasir || '-') + ' • buka ' + fmtJam(KAS.opened_at) + '\nKlik untuk tutup sesi')
      : 'Belum buka sesi kasir — klik untuk buka';
  }catch(e){ console.warn('renderKasUI:', e); }
}

// Guard transaksi: true = boleh lanjut, false = sudah buka modal sesi
function requireSesi(){
  if(kasSesiAktif()) return true;
  toast('🔒 Buka sesi kasir dulu sebelum input transaksi');
  showKasBuka();
  return false;
}
function isSesiError(msg){ return /sesi kasir/i.test(String(msg || '')); }
// true bila error itu "belum buka sesi" (409 dari backend) -> tampilkan modal, jangan simpan lokal
function handleSesiError(msg){
  if(!isSesiError(msg)) return false;
  toast('🔒 ' + msg);
  syncSesi().then(() => showKasBuka());
  return true;
}

async function showKasBuka(){
  try{
    if(kasSesiAktif()){ showKasTutup(); return; }
    if(useBackend() && !KAS) await syncSesi();
    if(kasSesiAktif()){ showKasTutup(); return; }
    const me = currentUser();
    if($('kasBukaInfo')) $('kasBukaInfo').innerHTML =
      '<b>Sedang login</b><span>' + esc(me ? me.nama : '-') + ' • ' + esc(roleLabel(me ? me.role : 'kasir')) + '</span>' +
      '<b>Waktu</b><span>' + new Date().toLocaleString('id-ID', {day:'2-digit', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit'}) + '</span>';
    if($('kas_modal') && !$('kas_modal').value) $('kas_modal').value = 0;
    await loadKasRiwayat();
    $('modalKasBuka').classList.remove('hidden');
  }catch(e){ console.warn('showKasBuka:', e); }
}

async function showKasTutup(){
  try{
    if(!kasSesiAktif()){ showKasBuka(); return; }
    if(!useBackend()) Object.assign(KAS, kasSummaryLocal(KAS));
    if($('kasHead')) $('kasHead').innerHTML =
      '<div class="kv"><b>Sesi</b><span>#' + esc(KAS.id || '-') + ' • ' + esc(KAS.kasir || '-') + '</span></div>' +
      '<div class="kv"><b>Buka pukul</b><span>' + fmtJam(KAS.opened_at) + '</span></div>' +
      '<div class="kv"><b>Modal awal</b><span>' + fmtRp(KAS.modal_awal) + '</span></div>';
    renderKasRekap();
    if($('kas_fisik')) $('kas_fisik').value = Number(KAS.kas_sistem || 0);
    if($('kas_catatan2')) $('kas_catatan2').value = '';
    updKasSelisih();
    await loadKasRiwayat();
    $('modalKasTutup').classList.remove('hidden');
  }catch(e){ console.warn('showKasTutup:', e); }
}

function renderKasRekap(){
  const s = KAS || {};
  if(!$('kasRekap')) return;
  $('kasRekap').innerHTML =
    '<span>Modal awal</span><span>' + fmtRp(s.modal_awal) + '</span>' +
    '<span>Penjualan tunai</span><span>+ ' + fmtRp(s.tunai_masuk) + '</span>' +
    '<span>Penjualan non-tunai</span><span>' + fmtRp(s.non_tunai) + '</span>' +
    '<span>Pengeluaran</span><span>− ' + fmtRp(s.pengeluaran_total) + '</span>' +
    '<span>Omzet service (Diambil)</span><span>' + fmtRp(s.service_omzet) + ' • ' + Number(s.service_count || 0) + ' unit</span>' +
    '<span>Nota penjualan</span><span>' + Number(s.penjualan_count || 0) + ' nota • ' + fmtRp(s.penjualan_total) + '</span>' +
    '<span class="kas-total">Kas seharusnya di laci</span><span class="kas-total">' + fmtRp(s.kas_sistem) + '</span>';
}

function updKasSelisih(){
  const el = $('kasSelisih'); if(!el) return;
  const fisik = Number(($('kas_fisik') || {}).value || 0);
  const sistem = Number((KAS && KAS.kas_sistem) || 0);
  const sel = fisik - sistem;
  el.className = 'kas-selisih ' + (sel === 0 ? 'ok' : 'bad');
  el.innerHTML = 'Selisih: <b>' + fmtRp(sel) + '</b> ' + (sel === 0 ? '(cocok ✅)' : (sel > 0 ? '(lebih)' : '(kurang)'));
}

function kasRiwayatHTML(list){
  if(!list || !list.length) return '<small class="muted">Belum ada riwayat sesi.</small>';
  return list.map(s => {
    const open = s.status === 'open';
    const kiri = '<b>#' + esc(s.id) + '</b> • ' + esc(s.kasir || '-') + '<br><small>' +
      fmtJam(s.opened_at) + (open ? ' → <b style="color:#166534">masih berjalan</b>' : ' → ' + fmtJam(s.closed_at)) + '</small>';
    const kanan = open
      ? '<span class="kas-hval">🔓 berjalan<br><small>' + fmtRp(s.kas_sistem || 0) + '</small></span>'
      : '<span class="kas-hval">' + fmtRp(s.kas_akhir || 0) + '<br><small>sistem ' + fmtRp(s.kas_sistem || 0) + ' • selisih ' + fmtRp(s.selisih || 0) + '</small></span>';
    return '<div class="kas-hrow"><div>' + kiri + '</div>' + kanan + '</div>';
  }).join('');
}

async function loadKasRiwayat(){
  let list = [];
  if(useBackend()){
    try{ list = await window.API.kasList({scope:'auto', limit:10}); }
    catch(e){ list = loadKasLocal().slice(0, 10); }
  } else {
    list = loadKasLocal().slice(0, 10);
  }
  KAS_RIWAYAT = Array.isArray(list) ? list : [];
  const html = kasRiwayatHTML(KAS_RIWAYAT);
  if($('kasRiwayatBuka')) $('kasRiwayatBuka').innerHTML = html;
  if($('kasRiwayatTutup')) $('kasRiwayatTutup').innerHTML = html;
}

async function kasBuka(){
  const me = currentUser();
  if(!me){ toast('Belum login'); return; }
  const modalAwal = Math.max(0, Number(($('kas_modal') || {}).value || 0));
  const catatan = (($('kas_catatan') || {}).value || '').trim();
  if(useBackend()){
    try{
      const s = await window.API.kasOpen({modal_awal: modalAwal, catatan});
      KAS = s; kasCache(s);
    }catch(err){
      if(handleSesiError(err.message)) return;
      toast(err.message); return;
    }
  } else {
    const open = kasOpenLocal();
    if(open){ KAS = open; toast('Sesi kasir masih terbuka'); showKasTutup(); return; }
    KAS = {
      id: Date.now(), user_id: me.id, kasir: me.nama || '', status: 'open',
      modal_awal: modalAwal, opened_at: new Date().toISOString(), closed_at: null,
      catatan, kas_akhir: 0, kas_sistem: modalAwal, selisih: 0,
      jml_transaksi: 0, penjualan_count: 0, penjualan_total: 0, tunai_masuk: 0,
      non_tunai: 0, pengeluaran_total: 0, service_count: 0, service_omzet: 0,
    };
    const list = loadKasLocal(); list.unshift(KAS); saveKasLocal(list.slice(0, 60));
  }
  if($('kas_catatan')) $('kas_catatan').value = '';
  $('modalKasBuka').classList.add('hidden');
  renderKasUI();
  toast('🔓 Sesi kasir dibuka • kas awal ' + fmtRp(modalAwal));
}

async function kasTutup(){
  if(!kasSesiAktif()){ toast('Belum ada sesi kasir terbuka'); return; }
  const sistem = Number(KAS.kas_sistem || 0);
  const fisik = Number(($('kas_fisik') || {}).value || 0);
  const sel = fisik - sistem;
  if(sel !== 0){
    if(!confirm('Hitungan kas fisik ' + fmtRp(fisik) + ' tidak sama dengan seharusnya ' + fmtRp(sistem) + ' (selisih ' + fmtRp(sel) + ').\nTetap tutup sesi?')) return;
  }
  const catatan = (($('kas_catatan2') || {}).value || '').trim();
  let hasil = null;
  if(useBackend()){
    try{
      const s = await window.API.kasClose(KAS.id, {kas_akhir: fisik, catatan});
      hasil = s; kasCache(s);
    }catch(err){
      if(handleSesiError(err.message)) return;
      toast(err.message); return;
    }
  } else {
    const sekarang = new Date().toISOString();
    const ringkas = kasSummaryLocal(Object.assign({}, KAS, {closed_at: sekarang}));
    hasil = Object.assign({}, KAS, ringkas, {
      status: 'closed', closed_at: sekarang, kas_akhir: fisik,
      kas_sistem: ringkas.kas_sistem, selisih: fisik - ringkas.kas_sistem,
      catatan: catatan ? ((KAS.catatan ? KAS.catatan + ' | ' : '') + catatan) : (KAS.catatan || ''),
    });
    saveKasLocal(loadKasLocal().map(x => String(x.id) === String(hasil.id) ? hasil : x));
  }
  KAS = null;
  $('modalKasTutup').classList.add('hidden');
  renderKasUI();
  const sel2 = Number((hasil && hasil.selisih) || 0);
  toast('🔒 Sesi ditutup • selisih ' + fmtRp(sel2) + (sel2 === 0 ? ' cocok ✅' : ' ⚠️ perhatian'));
}

function bindKas(){
  if($('kasPill')) $('kasPill').onclick = () => { kasSesiAktif() ? showKasTutup() : showKasBuka(); };
  if($('btnBukaKas')) $('btnBukaKas').onclick = kasBuka;
  if($('btnTutupKas')) $('btnTutupKas').onclick = kasTutup;
  if($('kas_fisik')) $('kas_fisik').addEventListener('input', updKasSelisih);
  // nominal cepat modal awal
  document.querySelectorAll('#kasQuick button').forEach(b => {
    b.onclick = () => { if($('kas_modal')) $('kas_modal').value = Number(b.dataset.nom || 0); };
  });
  // isi kas fisik = kas sistem
  if($('btnKasFisikSistem')) $('btnKasFisikSistem').onclick = () => {
    if($('kas_fisik')){ $('kas_fisik').value = Number((KAS && KAS.kas_sistem) || 0); updKasSelisih(); }
  };
}
try{ bindKas(); }catch(e){ console.warn('bindKas:', e); }

// ===== NAVIGASI =====
let curLtab='laba';
// tab aktif per grup menu (laporan & produk punya tab sendiri)
const NAVLTAB = { laporan:'laba', produk:'sparepart' };
function navSetGroup(grp, open){
  if(!grp) return;
  grp.classList.toggle('open', !!open);
  const h=grp.querySelector('.nav-head');
  if(h) h.setAttribute('aria-expanded', open?'true':'false');
}
function navSyncActive(page, ltab, group){
  if(ltab && group) NAVLTAB[group]=ltab;
  document.querySelectorAll('.nav-group').forEach(grp=>{
    const kids=[].slice.call(grp.querySelectorAll('.nav-sub-btn'));
    const head=grp.querySelector('.nav-head');
    const gkey=grp.dataset.group||'';
    const tab = gkey ? (NAVLTAB[gkey]||'') : '';
    const onPage=kids.some(k=>k.dataset.page===page) || !!(head && head.dataset.page && head.dataset.page===page);
    if(head) head.classList.toggle('active', onPage);
    if(onPage && kids.length){
      document.querySelectorAll('.nav-group.open').forEach(g=>{ if(g!==grp) navSetGroup(g,false); });
      navSetGroup(grp, true);
    }
    kids.forEach(k=>{
      const samePage=k.dataset.page===page;
      const sameTab=!k.dataset.ltab || !tab || k.dataset.ltab===tab;
      k.classList.toggle('active', samePage && sameTab);
    });
  });
}
// Klik menu utama: kalau grupnya punya sub-menu -> hanya buka sub-menu,
// kalau tidak (mis. Dashboard) -> langsung buka halamannya
document.querySelectorAll('.nav-head').forEach(h=>h.addEventListener('click',(e)=>{
  e.preventDefault();
  const grp=h.closest('.nav-group'); if(!grp) return;
  if(!grp.querySelector('.nav-sub')){
    const page=h.dataset.page||'';
    if(page){ goto(page); navSyncActive(page); }
    return;
  }
  const open=!grp.classList.contains('open');
  document.querySelectorAll('.nav-group.open').forEach(g=>{ if(g!==grp) navSetGroup(g,false); });
  navSetGroup(grp, open);
}));
// ===== FOKUS BAGIAN HALAMAN (klik sub-menu -> hanya bagian itu yang tampil) =====
let focusCard=null;
function clearFocus(){
  document.querySelectorAll('[data-focus-hidden]').forEach(c=>{ c.classList.remove('hidden'); c.removeAttribute('data-focus-hidden'); });
  focusCard=null;
  const btn=$('btnSettingAll'); if(btn) btn.classList.add('hidden');
}
function focusSection(pageId, cardId){
  clearFocus();
  const pg=$(pageId); const target=$(cardId);
  if(!pg || !target) return;
  pg.querySelectorAll('.card').forEach(c=>{
    if(c===target) return;
    if(c.classList.contains('hidden') && !c.hasAttribute('data-focus-hidden')) return; // yg memang hidden (khusus role) dibiarkan
    c.setAttribute('data-focus-hidden','1');
    c.classList.add('hidden');
  });
  focusCard=cardId;
  const btn=$('btnSettingAll'); if(btn) btn.classList.remove('hidden');
  try{ target.scrollIntoView({behavior:'smooth', block:'start'}); }catch{}
}
window.settingAll=function(){ clearFocus(); };
// ===== FOKUS LAPORAN: hanya laporan yg diklik yang tampil =====
function clearFokusLaporan(){
  const tabs=$('lpTabs'); if(tabs) tabs.classList.remove('hidden');
  document.querySelectorAll('#page-laporan .ltab-pane').forEach(p=>{
    if(p.hasAttribute('data-lap-hidden')){ p.classList.remove('hidden'); p.removeAttribute('data-lap-hidden'); }
  });
  const b=$('btnLaporanAll'); if(b) b.classList.add('hidden');
}
function fokusLaporanTab(ltab){
  clearFokusLaporan();
  const tabs=$('lpTabs'); if(tabs) tabs.classList.add('hidden');
  document.querySelectorAll('#page-laporan .ltab-pane').forEach(p=>{
    if(p.id!=='ltab-'+ltab){ p.setAttribute('data-lap-hidden','1'); p.classList.add('hidden'); }
  });
  const b=$('btnLaporanAll'); if(b) b.classList.remove('hidden');
}
window.laporanSemua=function(){ clearFokusLaporan(); };
// ===== FOKUS PRODUK: submenu sidebar -> hanya stok jenis itu yang tampil =====
function clearFokusProduk(){
  const tabs=$('prTabs'); if(tabs) tabs.classList.remove('hidden');
  const b=$('btnProdukAll'); if(b) b.classList.add('hidden');
}
function fokusProdukTab(ltab){
  clearFokusProduk();
  const tabs=$('prTabs'); if(tabs) tabs.classList.add('hidden');
  const b=$('btnProdukAll'); if(b) b.classList.remove('hidden');
}
window.produkSemua=function(){ clearFokusProduk(); };
// Klik sub-menu -> baru pindah halaman / tab
document.querySelectorAll('.nav-sub-btn').forEach(b=>b.addEventListener('click',(e)=>{
  e.preventDefault();
  const page=b.dataset.page||'';
  const ltab=b.dataset.ltab||'';
  const grp=b.closest('.nav-group');
  const gkey=grp ? (grp.dataset.group||'') : '';
  if(gkey==='produk'){
    if(ltab){ try{ gotoProdukTab(ltab); }catch{} }
  } else if(ltab && typeof gotoLtab==='function'){
    try{ gotoLtab(ltab); }catch{}
  }
  goto(page);
  if(gkey==='produk'){ if(ltab){ try{ fokusProdukTab(ltab); }catch{} } }
  else if(ltab){ try{ fokusLaporanTab(ltab); }catch{} }
  if(b.dataset.show){ try{ focusSection('page-'+page, b.dataset.show); }catch{} }
  else if(b.dataset.anchor){
    const el=$(b.dataset.anchor);
    if(el) setTimeout(()=>{ try{ el.scrollIntoView({behavior:'smooth', block:'start'}); }catch{} },160);
  }
  navSyncActive(page, ltab||undefined, gkey);
}));
document.querySelectorAll('[data-goto]').forEach(b=>b.addEventListener('click',()=>goto(b.dataset.goto)));
function goto(page, filter){
  if(page==='pengaturan' && myRole()==='kasir'){ toast('⛔ Pengaturan khusus Admin / Super Admin'); return; }
  if(page==='pengguna' && !isSuperAdmin()){ toast('⛔ Kelola Pengguna khusus Super Admin'); return; }
  try{ clearFocus(); }catch{}
  try{ clearFokusLaporan(); }catch{}
  try{ clearFokusProduk(); }catch{}
  navSyncActive(page);
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  $('page-'+page).classList.add('active');
  try{ hideGlobalResults(); }catch{}
  $('sidebar').classList.remove('open');
  const ov=$('sidebarOverlay'); if(ov) ov.classList.remove('show');
  // Buka menu Data HP: tanpa filter -> tampilkan SEMUA (reset);
  // dengan filter (dari link status dashboard) -> langsung filter status tsb.
  if(page==='data'){
    if(filter && (filter==='Semua' || STATUS.includes(filter))){
      activeFilter=filter;
      document.querySelectorAll('.fbtn').forEach(x=>x.classList.toggle('active', x.dataset.filter===filter));
      if($('globalSearch')) $('globalSearch').value='';
      if($('sortData')) $('sortData').value='baru';
      renderData();
    } else {
      resetDataView();
    }
    if(useBackend()){ pullServices().then(()=>{ renderAll(); }).catch(()=>{}); }
  }
  if(page==='dashboard'){ try{ renderOmzetChart(); }catch{} if(useBackend()){ pullServices().then(()=>{ renderAll(); }).catch(()=>{}); } }
  if(page==='produk'){ try{ renderSpareparts(); }catch{} if(useBackend()){ pullSpareparts().then(()=>{ renderAll(); }).catch(()=>{}); } }
  if(page==='penjualan'){ try{ renderSales(); }catch{} if(useBackend()){ pullSales().then(()=>{ try{renderSales();}catch{} }).catch(()=>{}); } }
  if(page==='pengeluaran'){ try{ renderExpenses(); }catch{} if(useBackend()){ pullExpenses().then(()=>{ try{renderExpenses();}catch{} try{renderLaporan();}catch{} }).catch(()=>{}); } }
  if(page==='laporan'){ try{ syncLpKasirOptions(); }catch{} try{ renderLaporan(); }catch{} if(useBackend()){ pullSpareparts().then(()=>{ try{ renderLaporan(); }catch{} }).catch(()=>{}); } }
  // Kas belum dibuka + kasir klik menu transaksi -> langsung munculkan menu Buka Sesi
  if(PAGES_TRANSAKSI.includes(page) && !kasSesiAktif()){ showKasBuka(); }
  window.scrollTo({top:0});
}
// Reset filter + search + sort supaya semua data HP masuk terlihat
function resetDataView(){
  activeFilter='Semua';
  document.querySelectorAll('.fbtn').forEach(x=>x.classList.toggle('active', x.dataset.filter==='Semua'));
  if($('globalSearch')) $('globalSearch').value='';
  if($('sortData')) $('sortData').value='baru';
  renderData();
}
$('openSidebar').onclick=()=>{ try{ openSidebar(); }catch{ $('sidebar').classList.add('open'); } };
$('closeSidebar').onclick=()=>{ try{ closeSidebar(); }catch{ $('sidebar').classList.remove('open'); } };
if($('sidebarOverlay')) $('sidebarOverlay').onclick=()=>{ closeSidebar(); };
// ===== SIDEBAR HELPERS (dipakai tombol back APK via MainActivity) =====
function openSidebar(){ try{ $('sidebar').classList.add('open'); }catch{} try{ const ov=$('sidebarOverlay'); if(ov) ov.classList.add('show'); }catch{} }
function closeSidebar(){ try{ $('sidebar').classList.remove('open'); }catch{} try{ const ov=$('sidebarOverlay'); if(ov) ov.classList.remove('show'); }catch{} }
function isSidebarOpen(){ try{ return !!($('sidebar')&&$('sidebar').classList.contains('open')); }catch{ return false; } }
try{ window.openSidebar=openSidebar; window.closeSidebar=closeSidebar; window.isSidebarOpen=isSidebarOpen; }catch{}

// ===== NOMOR SERVICE =====
function genNoService(){
  const d=new Date(); const y=d.getFullYear();
  // Nomor harus UNIK. Versi lama cuma menghitung record yang nomornya
  // mengandung tahun -> penghapusan record bisa menghasilkan nomor kembar.
  const used=new Set(DB.map(x=>String(x.noService||'')));
  let n=1, candidate=`SVC-${y}-${String(n).padStart(4,'0')}`;
  while(used.has(candidate)){ n++; candidate=`SVC-${y}-${String(n).padStart(4,'0')}`; }
  return candidate;
}
function refreshPreview(){ $('previewNoService').textContent = genNoService(); }

// ===== CHIPS KELENGKAPAN =====
document.querySelectorAll('#chipKelengkapan .chip').forEach(c=>c.addEventListener('click',()=>c.classList.toggle('on')));
function getKelengkapan(){ return [...document.querySelectorAll('#chipKelengkapan .chip.on')].map(c=>c.textContent.trim()); }
function clearChips(){ document.querySelectorAll('#chipKelengkapan .chip').forEach(c=>c.classList.remove('on')); }

// ===== KUNCI LAYAR ala HP: Tanpa / PIN / Pola =====
var lockType = 'none';
var pinCode = '';
var polaSeq = [];
function tickClock(){
  try{
    var t=new Date().toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}).replace('.',':');
    if($('pinClock')) $('pinClock').textContent=t;
    if($('polaClock')) $('polaClock').textContent=t;
  }catch{}
}
function switchLock(t){
  lockType=t;
  var tabs=document.querySelectorAll('#lockTabs .lock-tab');
  tabs.forEach(function(b){ b.classList.toggle('active', b.dataset.lock===t); });
  if($('phonePin')) $('phonePin').classList.toggle('hidden', t!=='pin');
  if($('phonePola')) $('phonePola').classList.toggle('hidden', t!=='pola');
  syncLockValue();
  // gambar ulang garis pola saat tab dibuka (ukuran sudah benar)
  if(t==='pola'){
    try{ if(window.requestAnimationFrame) window.requestAnimationFrame(function(){ drawPolaSvg(); }); }catch{}
    setTimeout(drawPolaSvg, 60);
  }
}
function renderPin(skipManual){
  var dots=document.querySelectorAll('#pinDots span');
  dots.forEach(function(d,i){ d.classList.toggle('fill', i<pinCode.length); });
  if($('pinValue')) $('pinValue').textContent = pinCode ? (new Array(Math.min(pinCode.length,12)+1).join('•')+'  '+pinCode) : '-';
  if(!skipManual && $('pinManual') && document.activeElement!==$('pinManual')) $('pinManual').value=pinCode;
  syncLockValue();
}
function pinPress(d){
  if(lockType!=='pin') switchLock('pin');
  if(pinCode.length>=16){ toast('PIN maksimal 16 digit'); return; }
  pinCode+=d;
  try{ if(navigator.vibrate) navigator.vibrate(10); }catch{}
  renderPin();
}
function syncLockValue(){
  var v='';
  var hint='';
  if(lockType==='pin'){ v=pinCode; hint = v ? ('🔢 PIN tersimpan: '+v) : 'Ketik PIN via keypad HP di atas.'; }
  else if(lockType==='pola'){
    v = polaSeq.length ? ('Pola: '+polaSeq.join('-')) : '';
    hint = polaSeq.length>=4 ? ('🔏 Pola tersimpan: '+polaSeq.join(' → ')) : (polaSeq.length ? ('Ketuk / geser lagi hingga min. 4 titik (baru '+polaSeq.length+'). Ulangi bila salah.') : 'Ketuk titik satu-satu ATAU tahan & geser dalam satu usapan.');
  }
  else { v=''; hint='Tidak ada kunci layar.'; }
  var h=$('f_sandi'); if(h) h.value=v;
  if($('lockHint')) $('lockHint').textContent=hint;
  if($('polaValue')) $('polaValue').textContent = polaSeq.length ? ('Pola: '+polaSeq.join(' → ')) : 'Pola: -';
}
function polaDraw(seq){
  polaSeq=[].concat(seq);
  document.querySelectorAll('#polaGrid .pola-dot').forEach(function(b){
    b.classList.toggle('hit', polaSeq.indexOf(b.dataset.dot)!==-1);
  });
  drawPolaSvg();
  syncLockValue();
}
function polaCenter(n){
  var wrap=$('polaWrap');
  var dot=document.querySelector('#polaGrid .pola-dot[data-dot="'+n+'"] i');
  if(!wrap||!dot) return null;
  var wr=wrap.getBoundingClientRect(), dr=dot.getBoundingClientRect();
  if(!wr.width||!wr.height) return null;
  var scaleX=228/wr.width, scaleY=228/wr.height;
  return { x:(dr.left+dr.width/2-wr.left)*scaleX, y:(dr.top+dr.height/2-wr.top)*scaleY };
}
function drawPolaSvg(){
  var svg=$('polaSvg'); if(!svg) return;
  try{ svg.setAttribute('viewBox','0 0 228 228'); }catch{}
  var html='';
  var pts=polaSeq.map(polaCenter).filter(Boolean);
  for(var i=0;i<pts.length-1;i++){
    html+='<line x1="'+pts[i].x+'" y1="'+pts[i].y+'" x2="'+pts[i+1].x+'" y2="'+pts[i+1].y+'" stroke="#2563eb" stroke-width="5" stroke-linecap="round" opacity="0.9"/>';
  }
  pts.forEach(function(p){ html+='<circle cx="'+p.x+'" cy="'+p.y+'" r="7" fill="#2563eb" stroke="#fff" stroke-width="3"/>'; });
  if(window._polaFinger) html+='<circle cx="'+window._polaFinger.x+'" cy="'+window._polaFinger.y+'" r="6" fill="#1d4ed8" opacity="0.7"/>';
  svg.innerHTML=html;
}
function polaAddDot(n){
  if(!n || polaSeq.indexOf(n)!==-1) return false;
  polaSeq.push(n);
  var b=document.querySelector('#polaGrid .pola-dot[data-dot="'+n+'"]');
  if(b) b.classList.add('hit');
  try{ if(navigator.vibrate) navigator.vibrate(8); }catch{}
  drawPolaSvg(); syncLockValue();
  return true;
}
function initPolaGrid(){
  var wrap=$('polaWrap'); if(!wrap || wrap.dataset.bound) return;
  wrap.dataset.bound='1';
  var drawing=false;
  var dotFromPoint=function(x,y){
    try{
      if(document.elementsFromPoint){
        var els=document.elementsFromPoint(x,y) || [];
        for(var i=0;i<els.length;i++){ var d=els[i].closest ? els[i].closest('.pola-dot') : null; if(d) return d.dataset.dot; }
      }
    }catch{}
    try{
      var r=wrap.getBoundingClientRect();
      if(!r.width||!r.height) return null;
      var cx=(x-r.left)/r.width, cy=(y-r.top)/r.height;
      if(cx<0||cx>1||cy<0||cy>1) return null;
      var col=Math.min(2,Math.floor(cx*3)), row=Math.min(2,Math.floor(cy*3));
      return String(row*3+col+1);
    }catch{ return null; }
  };
  var start=function(e){
    try{
      if(lockType!=='pola') switchLock('pola');
      // pola sudah jadi (>=4): usapan baru = mulai baru otomatis.
      // pola belum jadi: lanjutkan (mendukung ketuk satu-satu maupun geser).
      if(polaSeq.length>=4){
        var ae=document.activeElement;
        var fromKb = ae && ae.classList && ae.classList.contains('pola-dot');
        if(!fromKb){ polaDraw([]); }
      }
      drawing=true; window._polaFinger=null;
      var p=(e.touches&&e.touches[0])?e.touches[0]:e;
      if(p && typeof p.clientX==='number'){
        var n=dotFromPoint(p.clientX,p.clientY);
        if(n) polaAddDot(n); else drawPolaSvg();
      }
      if(e.cancelable) e.preventDefault();
    }catch(err){ console.warn('pola start:', err); }
  };
  var move=function(e){
    if(!drawing) return;
    try{
      var p=(e.touches&&e.touches[0])?e.touches[0]:e;
      if(!p || typeof p.clientX!=='number') return;
      var n=dotFromPoint(p.clientX,p.clientY);
      try{
        var wr=wrap.getBoundingClientRect();
        if(wr.width) window._polaFinger={ x:(p.clientX-wr.left)*(228/wr.width), y:(p.clientY-wr.top)*(228/wr.height) };
      }catch{}
      if(n) polaAddDot(n); else drawPolaSvg();
      if(e.cancelable) e.preventDefault();
    }catch(err){}
  };
  var end=function(){
    if(!drawing) return;
    drawing=false; window._polaFinger=null;
    drawPolaSvg(); syncLockValue();
    if(polaSeq.length && polaSeq.length<4) toast('Pola minimal 4 titik, lanjutkan ✏️');
  };
  wrap.addEventListener('pointerdown',start);
  window.addEventListener('pointermove',move,{passive:false});
  window.addEventListener('pointerup',end);
  window.addEventListener('pointercancel',end);
  wrap.addEventListener('touchstart',start,{passive:false});
  wrap.addEventListener('touchmove',move,{passive:false});
  wrap.addEventListener('touchend',end);
  wrap.addEventListener('touchcancel',end);
  // fallback keyboard / klik: tiap titik bisa diklik satu-satu
  document.querySelectorAll('#polaGrid .pola-dot').forEach(function(b){
    b.addEventListener('click',function(){
      if(drawing) return;
      if(lockType!=='pola') switchLock('pola');
      if(polaSeq.length>=4 && polaSeq.indexOf(b.dataset.dot)===-1){
        // klik titik baru setelah pola jadi = mulai baru? jangan, biarkan user tekan Ulangi.
        // tapi bila titik belum ada, anggap lanjut? batasi max 9.
        if(polaSeq.length>=9) return;
      }
      polaAddDot(b.dataset.dot);
    });
  });
  window.addEventListener('resize',function(){ drawPolaSvg(); });
}
function resetLockUI(){ pinCode=''; polaSeq=[]; var pm=$('pinManual'); if(pm) pm.value=''; try{ polaDraw([]); }catch{} try{ renderPin(); }catch{} try{ switchLock('none'); }catch{} }
function polaMiniHTML(sandi){
  var m=String(sandi||'').match(/[1-9](?:\s*[-→>,\s]\s*[1-9])+/);
  if(!m) return '';
  var nums=m[0].split(/[^1-9]+/).filter(Boolean);
  var dots='';
  for(var i=1;i<=9;i++) dots+='<i class="'+(nums.indexOf(String(i))!==-1?'on':'')+'"></i>';
  return '<span class="pola-mini">'+dots+'</span>';
}
function initLockUI(){
  try{
    var tabs = document.querySelectorAll('#lockTabs .lock-tab');
    if(!tabs.length) return false;
    tabs.forEach(function(b){
      if(b.dataset.lockBound) return;
      b.dataset.lockBound='1';
      b.addEventListener('click',function(){ switchLock(b.dataset.lock); });
    });
    document.querySelectorAll('#pinPad [data-pin]').forEach(function(b){
      if(b.dataset.pinBound) return;
      b.dataset.pinBound='1';
      b.addEventListener('click',function(){ pinPress(b.dataset.pin); });
    });
    var pb=$('pinBack'); if(pb && !pb.dataset.b){ pb.dataset.b='1'; pb.addEventListener('click',function(){ pinCode=pinCode.slice(0,-1); renderPin(); }); }
    var pc=$('pinClear'); if(pc && !pc.dataset.b){ pc.dataset.b='1'; pc.addEventListener('click',function(){ pinCode=''; renderPin(); }); }
    var pm=$('pinManual'); if(pm && !pm.dataset.b){ pm.dataset.b='1'; pm.addEventListener('input',function(){ if(lockType!=='pin') switchLock('pin'); pinCode=pm.value.replace(/\D/g,'').slice(0,16); renderPin(true); syncLockValue(); }); }
    var pr=$('polaReset'); if(pr && !pr.dataset.b){ pr.dataset.b='1'; pr.addEventListener('click',function(){ polaDraw([]); toast('Pola diulang ↺'); }); }
    var pcl=$('polaClear'); if(pcl && !pcl.dataset.b){ pcl.dataset.b='1'; pcl.addEventListener('click',function(){ polaDraw([]); }); }
    initPolaGrid();
    tickClock();
    switchLock(lockType||'none');
    renderPin();
    return true;
  }catch(err){ console.warn('initLockUI:', err); return false; }
}
window.switchLock=switchLock; window.pinPress=pinPress; window.polaDraw=polaDraw; window.resetLockUI=resetLockUI;
if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded',function(){ initLockUI(); setTimeout(initLockUI,300); }); }
initLockUI();
setTimeout(initLockUI,300);
setInterval(tickClock, 30000);

// ===== FORM SIMPAN (backend-first, fallback lokal) =====
$('serviceForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  if(!requireSesi()) return;
  const nama=$('f_nama').value.trim(), telp=$('f_telp').value.trim(),
        merk=$('f_merk').value.trim(), tipe=$('f_tipe').value.trim(),
        keluhan=$('f_keluhan').value.trim();
  if(!nama||!telp||!merk||!tipe||!keluhan){ toast('Lengkapi field bertanda *'); return; }
  const payload={
    tanggal: val('f_tanggal') || new Date().toISOString().slice(0,10),
    nama, telp, alamat:val('f_alamat').trim(),
    merk, tipe, warna:'', imei:'', sandi:val('f_sandi').trim(),
    kelengkapan:getKelengkapan(), keluhan, kondisi:val('f_kondisi').trim(),
    teknisi:val('f_teknisi'), biaya:Number(val('f_biaya',0)||0), dp:0,
    estimasi:val('f_estimasi'), catatan:val('f_catatan').trim(),
    status:normStatus(val('f_status','Dikerjakan')),
    kasir:(currentUser()&&currentUser().nama)||''
  };
  let savedNo = '';
  if(useBackend()){
    try{
      const created = await window.API.createService(payload);
      savedNo = created.noService;
      await pullServices();
    }catch(err){ if(handleSesiError(err.message)) return; toast('Backend gagal, simpan lokal: '+err.message); }
  }
  if(!savedNo){
    const item={ id: Date.now(), noService: genNoService(), ...payload, riwayat:[{t:new Date().toISOString(), s:payload.status}] };
    DB.unshift(item); saveData();
    savedNo = item.noService;
  }
  e.target.reset(); clearChips(); try{ resetLockUI(); }catch{} initTanggal(); refreshPreview();
  if($('previewNotaBox')) $('previewNotaBox').textContent='Belum ada preview. Isi form lalu klik Preview Nota.';
  // reset filter & search supaya data baru pasti terlihat di Data HP
  activeFilter='Semua';
  document.querySelectorAll('.fbtn').forEach(x=>x.classList.toggle('active', x.dataset.filter==='Semua'));
  if($('globalSearch')) $('globalSearch').value='';
  if($('sortData')) $('sortData').value='baru';
  renderAll();
  // sinkron ulang dari backend agar nomor & data valid
  if(useBackend()){ pullServices().then(()=>renderAll()); }
  toast('Service '+savedNo+' tersimpan ✅');
  goto('data');
});
$('btnResetForm').onclick=()=>{ $('serviceForm').reset(); clearChips(); try{ resetLockUI(); }catch{} initTanggal(); refreshPreview(); if($('previewNotaBox')) $('previewNotaBox').textContent='Belum ada preview. Isi form lalu klik Preview Nota.'; };
function initTanggal(){ const t=new Date().toISOString().slice(0,10); $('f_tanggal').value=t; const e=new Date(Date.now()+3*864e5).toISOString().slice(0,10); $('f_estimasi').value=e; }

// ===== RENDER =====
function filtered(){
  let r=[...DB];
  const q=(($('globalSearch') && $('globalSearch').value)||'').toLowerCase().trim();
  if(q) r=r.filter(x=>[(x.noService||''),(x.nama||''),(x.telp||''),(x.merk||''),(x.tipe||''),(x.keluhan||'')].join(' ').toLowerCase().includes(q));
  if(activeFilter!=='Semua') r=r.filter(x=>normStatus(x.status)===activeFilter);
  const s=$('sortData') ? $('sortData').value : 'baru';
  if(s==='baru') r.sort((a,b)=>(b.id||0)-(a.id||0));
  if(s==='lama') r.sort((a,b)=>(a.id||0)-(b.id||0));
  if(s==='nama') r.sort((a,b)=>String(a.nama||'').localeCompare(String(b.nama||'')));
  return r;
}

function renderAll(){ renderStats(); renderOmzetChart(); renderRecent(); renderData(); renderQueue(); renderSettingUI(); refreshPreview(); renderUsers(); renderHeadbar(); renderSlideManager(); renderSpareparts(); try{ renderSales(); }catch{} try{ renderExpenses(); }catch{} try{ renderLaporan(); }catch{} try{ renderKasUI(); }catch{} }

let DASH_RANGE=1; // 1 = hari ini (default), 7 = 7 hari, 30 = 30 hari
function dashRangeSet(n){
  DASH_RANGE=[1,7,30].includes(Number(n))?Number(n):1;
  document.querySelectorAll('#dashRange [data-dash]').forEach(b=>b.classList.toggle('active',Number(b.dataset.dash)===DASH_RANGE));
  const lbl=DASH_RANGE===1?'hari ini':`${DASH_RANGE} hari terakhir`;
  if($('dashSub')) $('dashSub').textContent=`Ringkasan operasional service HP ${lbl} • klik status untuk melihat datanya`;
  renderStats();
}
window.dashRangeSet=dashRangeSet;
function renderStats(){
  // Dashboard = ringkasan per tanggal (default hari ini), bukan akumulasi semua waktu.
  const sampai=new Date().toISOString().slice(0,10);
  const dari=new Date(Date.now()-(DASH_RANGE-1)*864e5).toISOString().slice(0,10);
  const day=DB.filter(x=>inPeriode(String(x.tanggal||'').slice(0,10),dari,sampai));
  const c=(s)=>day.filter(x=>normStatus(x.status)===s).length;
  $('stTotal').textContent=day.length;
  $('stAntri').textContent=c('Dikerjakan');
  $('stProses').textContent=c('Selesai');
  $('stSelesai').textContent=c('Diambil');
  // Omzet hanya dari service yang SUDAH DIAMBIL (dalam rentang tanggal)
  $('stOmzet').textContent=fmtRp(day.filter(x=>normStatus(x.status)==='Diambil').reduce((a,b)=>a+Number(b.biaya||0),0));
  // Link status di dashboard -> ketuk untuk buka Data Service terfilter
  if($('statusLinks')){ try { $('statusLinks').innerHTML=''; } catch(e){} }
  if($('statusChart')){ try { $('statusChart').innerHTML=''; $('statusChart').style.display='none'; } catch(e){} }
  if($('cardStatusService')){ try { $('cardStatusService').remove(); } catch(e){} }
  if($('attentionList')){
    const lama=DB.filter(x=>!['Selesai','Diambil','Cancel'].includes(normStatus(x.status))).slice(0,5);
    const lowSp=(typeof SPARE!=='undefined'?SPARE:[]).filter(x=>Number(x.stok||0)<=Number(x.stok_min||0)).slice(0,3);
    const lowHtml=lowSp.map(x=>`<div class="att-item"><b>🔧 ${esc(x.sku)}</b> • ${esc(x.nama)}<br><small>Stok ${esc(x.stok)} / min ${esc(x.stok_min)}</small><br><span class="badge b-Batal">Stok Menipis</span></div>`).join('');
    const lamaHtml=lama.map(x=>`<div class="att-item"><b>${esc(x.noService)}</b> • ${esc(x.nama)}<br><small>${esc(x.merk)} ${esc(x.tipe)} — ${esc(String(x.keluhan||'').slice(0,50))}</small><br>${badge(x.status)}</div>`).join('');
    $('attentionList').innerHTML = (lamaHtml+lowHtml) || '<small class="muted">Semua aman, tidak ada antrian. 🎉</small>';
  }
}

function renderRecent(){
  if(!$('recentTable')) return;
  $('recentTable').innerHTML = DB.slice(0,6).map(x=>`<tr><td><b>${esc(x.noService)}</b></td><td>${esc(x.nama)}</td><td>${esc(x.merk)} ${esc(x.tipe)}</td><td>${badge(x.status)}</td></tr>`).join('') || '<tr><td colspan="4">Belum ada data</td></tr>';
}

function renderData(){
  const r=filtered();
  $('emptyData').classList.toggle('hidden', r.length>0);
  // Info jumlah: tampilkan semua data yang masuk
  if($('dataCount')) $('dataCount').textContent = DB.length + ' data masuk';
  if($('dataInfo')){
    if(r.length===DB.length) $('dataInfo').textContent = r.length ? `• menampilkan semua (${r.length})` : '';
    else $('dataInfo').textContent = `• menampilkan ${r.length} dari ${DB.length} (filter: ${activeFilter}${$('globalSearch').value?' + pencarian':''})`;
  }
  if(!r.length){ $('dataTable').innerHTML=''; return; }
  $('dataTable').innerHTML=r.map(x=>{
    const keluhan=String(x.keluhan||'');
    const wa=waHref(x);
    return `<tr>
      <td><b>${esc(x.noService)}</b><br><small class="muted">${fmtTgl(x.tanggal)}</small></td>
      <td>${esc(x.nama)}<br><small class="muted">${esc(x.telp)}</small></td>
      <td><b>${esc(x.merk)} ${esc(x.tipe)}</b></td>
      <td><small>${esc(keluhan.slice(0,40))}${keluhan.length>40?'...':''}</small></td>
      <td><b>${fmtRp(x.biaya)}</b></td>
      <td>${badge(x.status)}</td>
      <td><div class="act-btns">
        <button class="icon-btn" onclick="detail(${jsStr(x.id)})" title="Detail">👁</button>
        <button class="icon-btn" onclick="cetak(${jsStr(x.id)})" title="Nota">🖨</button>
        ${isAdminUp() ? `<button class="icon-btn" onclick="edit(${jsStr(x.id)})" title="Edit">✏️</button>
        <button class="icon-btn" onclick="hapus(${jsStr(x.id)})" title="Hapus">🗑</button>` : ``}
        ${wa ? `<a class="icon-btn wa-btn" href="${wa}" target="_blank" rel="noopener" title="Chat WhatsApp ${esc(x.nama)}">💬</a>` : ``}
      </div></td></tr>`;
  }).join('');
}

// filter + search + sort
document.querySelectorAll('.fbtn').forEach(b=>b.onclick=()=>{ document.querySelectorAll('.fbtn').forEach(x=>x.classList.remove('active')); b.classList.add('active'); activeFilter=b.dataset.filter; renderData(); });
$('globalSearch').addEventListener('input',()=>{ renderData(); renderGlobalResults(); });
$('sortData').onchange=renderData;
if($('btnTampilSemua')) $('btnTampilSemua').onclick=()=>{ resetDataView(); toast('Menampilkan semua data HP ✅'); };

// ===== PENCARIAN GLOBAL: service/lacak + produk dalam satu kolom =====
function hideGlobalResults(){ const g=$('globalResults'); if(g) g.classList.add('hidden'); }
try{ window.hideGlobalResults=hideGlobalResults; }catch{}
function renderGlobalResults(){
  const box=$('globalResults'), inp=$('globalSearch');
  if(!box||!inp) return;
  const raw=(inp.value||'').trim(), q=raw.toLowerCase();
  if(q.length<2){ hideGlobalResults(); return; }
  const svc=(typeof DB!=='undefined'?DB:[]).filter(x=>[(x.noService||''),(x.nama||''),(x.telp||''),(x.merk||''),(x.tipe||''),(x.keluhan||'')].join(' ').toLowerCase().includes(q)).slice(0,6);
  const spr=(typeof SPARE!=='undefined'?SPARE:[]).filter(x=>[(x.nama||''),(x.sku||''),(x.merk||''),((x&&x.kategori)||'')].join(' ').toLowerCase().includes(q)).slice(0,6);
  if(!svc.length&&!spr.length){
    box.innerHTML=`<div class="gr-empty">Tidak ketemu "<b>${esc(raw.slice(0,40))}</b>" di service maupun produk.</div>`;
    box.classList.remove('hidden'); return;
  }
  let h='';
  if(svc.length){
    h+=`<div class="gr-group">📲 Service & Lacak (${svc.length})</div>`+svc.map(x=>`<button type="button" class="gr-item" onclick="gGoDetail(${jsStr(x.id)})"><span><b>${esc(x.noService)}</b> • ${esc(x.nama)}<br><small class="muted">${esc(x.merk)} ${esc(x.tipe)} • ${esc(x.telp)}</small></span>${badge(x.status)}</button>`).join('')
      +`<button type="button" class="gr-more" onclick="gAllService()">Lihat semua di Data Service →</button>`
      +`<button type="button" class="gr-more" onclick="gOpenLacak()">Lacak di halaman Lacak →</button>`;
  }
  if(spr.length){
    h+=`<div class="gr-group">📦 Produk (${spr.length})</div>`+spr.map(x=>`<button type="button" class="gr-item" onclick="gGoSpare('${jsStr(x.id)}')"><span><b>${esc(x.nama)}</b><br><small class="muted">${esc(x.sku)} • stok ${esc(x.stok)} • ${fmtRp(x.harga_jual)}</small></span></button>`).join('')
      +`<button type="button" class="gr-more" onclick="gAllSpare()">Lihat semua di Data Sparepart →</button>`;
  }
  box.innerHTML=h; box.classList.remove('hidden');
}
window.gGoDetail=function(id){ hideGlobalResults(); if(typeof detail==='function') detail(id); };
window.gGoSpare=function(id){
  hideGlobalResults();
  const x=(typeof findSpare==='function')?findSpare(id):null;
  // buka tab produk sesuai jenis barangnya
  if(x){
    const j=spJenis(x);
    const tab=Object.keys(PR_TABS).find(k=>PR_TABS[k]===j) || 'sparepart';
    try{ gotoProdukTab(tab); navSyncActive('produk', tab, 'produk'); }catch{}
  }
  goto('produk');
  try{ fokusProdukTab(Object.keys(PR_TABS).find(k=>PR_TABS[k]===spJenis(x)) || 'sparepart'); }catch{}
  if($('spSearch')) $('spSearch').value=x?String(x.sku||''):'';
  try{ renderSpareparts(); }catch{}
};
window.gAllService=function(){
  hideGlobalResults(); closeSidebar();
  navSyncActive('data');
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  $('page-data').classList.add('active');
  activeFilter='Semua';
  document.querySelectorAll('.fbtn').forEach(x=>x.classList.toggle('active', x.dataset.filter==='Semua'));
  if($('sortData')) $('sortData').value='baru';
  renderData();
  if(useBackend()){ pullServices().then(()=>{ renderAll(); }).catch(()=>{}); }
  window.scrollTo({top:0});
};
window.gAllSpare=function(){
  const q=($('globalSearch')||{}).value||'';
  hideGlobalResults(); goto('produk');
  if($('spSearch')) $('spSearch').value=q;
  try{ renderSpareparts(); }catch{}
};
window.gOpenLacak=function(){
  const q=($('globalSearch')||{}).value||'';
  hideGlobalResults(); goto('lacak');
  if($('lacakInput')) $('lacakInput').value=q;
  try{ doLacak(); }catch{}
};
// Tutup dropdown: klik di luar / tombol Escape
document.addEventListener('click',(e)=>{
  try{
    const box=$('globalResults');
    if(!box||box.classList.contains('hidden')) return;
    if(e.target&&e.target.closest&&(e.target.closest('.search-wrap')||e.target.closest('#globalResults'))) return;
    hideGlobalResults();
  }catch{}
});
document.addEventListener('keydown',(e)=>{ if(e.key==='Escape'){ try{ hideGlobalResults(); }catch{} } });

// ===== DETAIL =====
window.detail=function(id){
  const x=DB.find(d=>d.id===id); if(!x) return;
  $('detailTitle').textContent='Detail '+x.noService;
  $('detailBody').innerHTML=`
    <div style="margin-bottom:10px">${badge(x.status)}</div>
    <div class="kv"><b>Pelanggan</b><span>${esc(x.nama)} • ${esc(x.telp)}<br><small>${esc(x.alamat||'-')}</small></span></div>
    <div class="kv"><b>Unit HP</b><span>${esc(x.merk)} ${esc(x.tipe)}<br><small>Sandi: ${esc(x.sandi||'-')}${(typeof polaMiniHTML==='function'?polaMiniHTML(x.sandi):'')}</small></span></div>
    <div class="kv"><b>Kelengkapan</b><span>${esc((x.kelengkapan||[]).join(', ')||'-')}</span></div>
    <div class="kv"><b>Keluhan</b><span>${esc(x.keluhan)}</span></div>
    <div class="kv"><b>Kondisi Fisik</b><span>${esc(x.kondisi||'-')}</span></div>
    <div class="kv"><b>Teknisi</b><span>${esc(x.teknisi||'-')}</span></div>
    <div class="kv"><b>Biaya</b><span><b>${fmtRp(x.biaya)}</b></span></div>
    <div class="kv"><b>Tgl Masuk / Estimasi</b><span>${fmtTgl(x.tanggal)} / ${fmtTgl(x.estimasi)}</span></div>
    <div class="kv"><b>Catatan</b><span>${esc(x.catatan||'-')}</span></div>
    <div class="kv"><b>Ubah Status</b><span><select class="status-select" id="quickStatus">${STATUS.map(s=>`<option ${s===x.status?'selected':''}>${s}</option>`).join('')}</select></span></div>
    <h4 style="margin:10px 0 6px">Riwayat</h4>
    <small class="muted">${(x.riwayat||[]).map(r=>`• ${new Date(r.t).toLocaleString('id-ID')} — <b>${esc(r.s)}</b>`).join('<br>')||'-'}</small>`;
  $('detailFoot').innerHTML=`
    <button class="btn ghost" onclick="cetak(${jsStr(x.id)})">🖨 Cetak Nota</button>
    ${waHref(x) ? `<button class="btn ghost" onclick="bukaWa(${jsStr(x.id)},'status')">💬 Chat WA</button>` : ``}
    ${isAdminUp() ? `<button class="btn ghost" onclick="edit(${jsStr(x.id)})">✏️ Edit</button>` : ``}
    <button class="btn primary" onclick="saveStatus(${jsStr(x.id)})">Simpan Status</button>`;
  $('modalDetail').classList.remove('hidden');
};
// ===== KIRIM WHATSAPP =====
// Buka modal konfirmasi WA (preview pesan + tombol buka WhatsApp).
// mode: 'ambil' = pesan "siap diambil", 'status' = update status biasa.
window.bukaWa=function(id, mode){
  const x=DB.find(d=>d.id===id); if(!x) return;
  const mode2=mode||'status';
  const href = mode2==='ambil' ? waHrefAmbil(x) : waHref(x);
  if(!href){ toast('Nomor HP pelanggan tidak valid untuk WhatsApp'); return; }
  const n=waNumber(x.telp);
  $('waTujuan').innerHTML=`Pelanggan: <b>${esc(x.nama||'-')}</b> • ${esc(x.telp||'-')} (${esc(n)})<br>Service <b>${esc(x.noService||'')}</b> — ${esc(x.merk||'')} ${esc(x.tipe||'')}`;
  const pesan = mode2==='ambil' ? waPesanAmbil(x)
    : decodeURIComponent((href.split('text=')[1]||''));
  $('waPesan').value=pesan;
  $('waFoot').innerHTML=`
    <button class="btn ghost" onclick="closeWa()">Batal</button>
    <a class="btn primary wa-btn" id="waKirimLink" href="${esc(href)}" target="_blank" rel="noopener" onclick="tandaiWaTerkirim(${jsStr(x.id)})">📱 Buka WhatsApp</a>`;
  $('modalWa').classList.remove('hidden');
  $('waPesan').focus();
};
window.closeWa=function(){ $('modalWa').classList.add('hidden'); };
// Tandai notifikasi WA sudah dikirim (agar masuk rekap harian).
window.tandaiWaTerkirim=function(id){
  try{
    if(!useBackend()) return;
    window.API.markWaSent(id).then(()=>{
      try{ const x=DB.find(d=>d.id===id); if(x){ x.wa_terkirim_at=new Date().toISOString(); } }catch{}
    }).catch(()=>{});
  }catch{}
};
// Setelah service -> Diambil: buka modal WA "siap diambil".
// Pelanggan otomatis diberi tahu unitnya sudah selesai.
function tawarkanWaAmbil(id){
  const x=DB.find(d=>d.id===id); if(!x) return;
  if(!waHrefAmbil(x)) return;                       // nomor HP tidak valid -> diamkan
  if(x.wa_terkirim_at){ toast('Status → Diambil. Notifikasi WA sudah pernah dikirim.', 3500); return; }
  setTimeout(()=>{ try{ window.bukaWa(id,'ambil'); }catch{} }, 350);
}
window.saveStatus=async function(id){
  const x=DB.find(d=>d.id===id); const ns=$('quickStatus').value;
  if(useBackend()){
    try{
      await window.API.setStatus(id, ns);
      await pullServices();
      renderAll(); $('modalDetail').classList.add('hidden');
      toast('Status → '+ns);
      // Status "Diambil" = pelanggan siap mengambil -> tawarkan kirim WA.
      if(normStatus(ns)==='Diambil'){ try{ tawarkanWaAmbil(id); }catch{} }
      return;
    }
    catch(err){ toast('Backend gagal: '+err.message); }
  }
  if(!x) return;
  x.status=ns; x.riwayat=x.riwayat||[]; x.riwayat.push({t:new Date().toISOString(),s:ns});
  saveData(); renderAll(); $('modalDetail').classList.add('hidden'); toast('Status → '+ns);
  if(normStatus(ns)==='Diambil'){ try{ tawarkanWaAmbil(id); }catch{} }
};

// ===== EDIT / HAPUS (Admin & Super Admin saja) =====
window.edit=function(id){
  if(!needAdmin()) return;
  const x=DB.find(d=>d.id===id); if(!x) return; editId=id;
  $('modalDetail').classList.add('hidden');
  $('e_nama').value=x.nama; $('e_telp').value=x.telp; $('e_merk').value=x.merk; $('e_tipe').value=x.tipe;
  $('e_keluhan').value=x.keluhan; $('e_biaya').value=x.biaya;
  $('e_catatan').value=x.catatan||''; $('e_status').value=x.status;
  fillTeknisi($('e_teknisi'), x.teknisi);
  $('modalEdit').classList.remove('hidden');
};
$('btnSaveEdit').onclick=async ()=>{
  if(!needAdmin()) return;
  const payload={ nama:$('e_nama').value, telp:$('e_telp').value, merk:$('e_merk').value, tipe:$('e_tipe').value,
    keluhan:$('e_keluhan').value, biaya:Number($('e_biaya').value||0),
    teknisi:$('e_teknisi').value, catatan:$('e_catatan').value, status:$('e_status').value };
  if(useBackend()){
    try{ await window.API.updateService(editId, payload); await pullServices(); renderAll(); $('modalEdit').classList.add('hidden'); toast('Perubahan disimpan ✅'); return; }
    catch(err){ toast('Backend gagal: '+err.message); return; }
  }
  const x=DB.find(d=>d.id===editId); if(!x) return;
  const oldStatus=x.status;
  Object.assign(x, payload);
  x.riwayat=x.riwayat||[];
  if(oldStatus!==payload.status){ x.riwayat.push({t:new Date().toISOString(),s:payload.status}); }
  saveData(); renderAll(); $('modalEdit').classList.add('hidden'); toast('Perubahan disimpan ✅');
};
window.hapus=async function(id){
  if(!needAdmin()) return;
  const x=DB.find(d=>d.id===id); if(!x) return;
  if(!confirm('Hapus '+x.noService+' - '+x.nama+'?')) return;
  if(useBackend()){
    try{ await window.API.deleteService(id); await pullServices(); renderAll(); toast('Data dihapus'); return; }
    catch(err){ toast('Backend gagal: '+err.message); return; }
  }
  DB=DB.filter(d=>d.id!==id); saveData(); renderAll(); toast('Data dihapus');
};
function closeAllModals(){
  ['modalDetail','modalEdit','modalSpare','modalExpense','modalKasBuka','modalKasTutup','modalWa'].forEach(id=>{ const m=$(id); if(m) m.classList.add('hidden'); });
  if(typeof closeScan==='function'){
    try{
      const ms=$('modalScan');
      if(ms && !ms.classList.contains('hidden')) closeScan();
    }catch{}
  } else {
    const ms=$('modalScan'); if(ms) ms.classList.add('hidden');
  }
  try{ window.closeAllModals=closeAllModals; }catch{}
}
window.closeAllModals=closeAllModals;
function bindCloseButtons(){
  // Delegasi global: semua [data-close] pasti menutup modal (tahan terhadap render ulang)
  document.addEventListener('click',(e)=>{
    const t=(e.target && e.target.closest) ? e.target.closest('[data-close]') : null;
    if(t){ e.preventDefault(); closeAllModals(); }
  });
  // Binding langsung sebagai cadangan (misal browser lama tanpa closest)
  try{
    document.querySelectorAll('[data-close]').forEach(b=>{ b.setAttribute('type','button'); b.onclick=()=>closeAllModals(); });
  }catch{}
  const bc=$('btnCancelSpare'); if(bc){ bc.setAttribute('type','button'); bc.onclick=()=>closeAllModals(); }
  const bx=$('btnCloseSpareX'); if(bx){ bx.setAttribute('type','button'); bx.onclick=()=>closeAllModals(); }
}
bindCloseButtons();
document.querySelectorAll('.modal-bg').forEach(m=>m.addEventListener('click',(e)=>{
  if(e.target!==m) return;
  if(m.id==='modalScan' && typeof closeScan==='function') closeScan();
  else m.classList.add('hidden');
}));
document.addEventListener('keydown',(e)=>{
  if(e.key==='Escape') closeAllModals();
});

// ===== LACAK =====
function timelineHTML(cur){
  cur=normStatus(cur);
  const order=['Dikerjakan','Selesai','Diambil'];
  if(cur==='Cancel') return `<div class="result-card">❌ Service <b>dibatalkan (Cancel)</b>.</div>`;
  let idx=order.indexOf(cur); if(idx<0) idx=0;
  return `<div class="timeline">${order.map((s,i)=>`<div class="t-step ${i<=idx?'done':''}">${i<=idx?'✅':'○'}<br>${s}</div>`).join('')}</div>`;
}
function doLacak(){
  const q=($('lacakInput').value||'').trim().toLowerCase();
  if(!q){ $('lacakResult').innerHTML='<small class="muted">Masukkan nomor service / nama / No. HP dulu.</small>'; return; }
  const r=DB.filter(x=>[x.noService,x.nama,x.telp].join(' ').toLowerCase().includes(q));
  if(!r.length){ $('lacakResult').innerHTML=`<div class="result-card">🔍 Tidak ditemukan untuk "<b>${esc(q)}</b>". Periksa kembali nomor service.</div>`; return; }
  $('lacakResult').innerHTML=r.slice(0,5).map(x=>{
    return `<div class="result-card">
      <b>${esc(x.noService)}</b> ${badge(x.status)}<br>
      <small class="muted">${esc(x.nama)} • ${esc(x.merk)} ${esc(x.tipe)} • Masuk: ${fmtTgl(x.tanggal)} • Teknisi: ${esc(x.teknisi||'-')}</small>
      ${timelineHTML(x.status)}
      <div class="kv"><b>Keluhan</b><span>${esc(x.keluhan)}</span></div>
      <div class="kv"><b>Biaya</b><span><b>${fmtRp(x.biaya)}</b></span></div>
      <div class="btn-row"><button class="btn small" onclick="cetak(${jsStr(x.id)})">🖨 Nota</button><button class="btn small" onclick="detail(${jsStr(x.id)})">👁 Detail</button></div>
    </div>`;
  }).join('');
}
$('btnLacak').onclick=doLacak;
$('lacakInput').addEventListener('keydown',(e)=>{ if(e.key==='Enter') doLacak(); });
function renderQueue(){
  const q=DB.filter(x=>!['Diambil','Cancel'].includes(normStatus(x.status)));
  $('queueList').innerHTML=q.slice(0,10).map(x=>`<div class="q-item"><span><b>${esc(x.noService)}</b> • ${esc(x.nama)} • ${esc(x.merk)} ${esc(x.tipe)}</span>${badge(x.status)}</div>`).join('') || '<small class="muted">Antrian kosong 🎉</small>';
}

// ===== NOTA / PRINT =====
function notaHTML(x){
  return `<div class="nota">
    <h2>${esc(SET.nama)}</h2>
    <p style="text-align:center">${esc(SET.alamat)}<br>Telp: ${esc(SET.telp)}</p>
    <hr>
    <p><b>NOTA SERVICE: ${esc(x.noService)}</b><br>Tgl Masuk: ${fmtTgl(x.tanggal)} • Estimasi: ${fmtTgl(x.estimasi)}</p>
    <hr>
    <p><b>Pelanggan:</b> ${esc(x.nama)} (${esc(x.telp)})<br>${esc(x.alamat||'')}</p>
    <p><b>Unit:</b> ${esc(x.merk)} ${esc(x.tipe)} | Sandi: ${esc(x.sandi||'-')}<br>
    <b>Kelengkapan:</b> ${esc((x.kelengkapan||[]).join(', ')||'-')}<br>
    <b>Keluhan:</b> ${esc(x.keluhan)}<br><b>Kondisi:</b> ${esc(x.kondisi||'-')}</p>
    <hr>
    <p><b>Biaya:</b> ${fmtRp(x.biaya)}<br>Status: ${esc(x.status)} • Teknisi: ${esc(x.teknisi||'-')}</p>
    <hr>
    <p><small>${esc(SET.nota)}</small></p>
    <br><br>
    <table style="width:100%;text-align:center"><tr><td>Pelanggan<br><br><br>( ............ )</td><td>Teknisi<br><br><br>( ${esc(x.teknisi||'........')} )</td></tr></table>
  </div>`;
}
window.cetak=function(id){
  const x=DB.find(d=>d.id===id); if(!x) return;
  // Prioritas: printer Bluetooth thermal (APK) -> fallback print browser
  try{ if(typeof tryPrintServiceBT==='function' && tryPrintServiceBT(x)) return; }catch(e){ console.warn('BT print gagal:', e); }
  $('printArea').innerHTML=notaHTML(x);
  window.print();
};
$('btnTestPrint').onclick=()=>{
  $('notaPreview').textContent=`${SET.nama}\n${SET.alamat}\nTelp: ${SET.telp}\n--------------------------\nNOTA SERVICE: SVC-2026-0001\nPelanggan: Contoh ...\nBiaya: Rp 150.000\n--------------------------\n${SET.nota}`;
};

// ===== PREVIEW NOTA SAAT INPUT (tanpa simpan dulu) =====
function buildPreviewItem(){
  return {
    noService: ($('previewNoService') ? $('previewNoService').textContent : genNoService()) || genNoService(),
    tanggal: val('f_tanggal') || new Date().toISOString().slice(0,10),
    nama: val('f_nama') || '(nama pelanggan)',
    telp: val('f_telp') || '-',
    alamat: val('f_alamat'),
    merk: val('f_merk') || '-',
    tipe: val('f_tipe') || '',
    sandi: val('f_sandi'),
    kelengkapan: getKelengkapan(),
    keluhan: val('f_keluhan') || '-',
    kondisi: val('f_kondisi'),
    teknisi: val('f_teknisi'),
    biaya: Number(val('f_biaya',0)||0),
    estimasi: val('f_estimasi'),
    catatan: val('f_catatan'),
    status: normStatus(val('f_status','Dikerjakan'))
  };
}
function refreshInputPreview(){
  if(!$('previewNotaBox')) return;
  const item = buildPreviewItem();
  $('previewNotaBox').innerHTML = notaHTML(item);
}
if($('btnPreviewNota')) $('btnPreviewNota').onclick=()=>{ refreshInputPreview(); toast('Preview nota diperbarui 👁'); if($('previewNotaCard')) $('previewNotaCard').scrollIntoView({behavior:'smooth', block:'nearest'}); };
if($('btnRefreshPreviewNota')) $('btnRefreshPreviewNota').onclick=()=>{ refreshInputPreview(); toast('Preview nota diperbarui 🔄'); };
if($('btnCetakPreview')) $('btnCetakPreview').onclick=()=>{
  const item = buildPreviewItem();
  if(!val('f_nama').trim() || !val('f_telp').trim()){ toast('Isi minimal Nama + No. HP dulu'); return; }
  try{ if(typeof tryPrintServiceBT==='function' && tryPrintServiceBT(item)) return; }catch(e){ console.warn('BT print gagal:', e); }
  $('printArea').innerHTML = notaHTML(item);
  window.print();
};

// ===== CSV / BACKUP =====
function toCSV(){
  const h=['NoService','Tanggal','Nama','Telp','Merk','Tipe','Keluhan','Biaya','Status','Teknisi'];
  // Semua kolom harus di-escape: hanya kolom keluhan yang dulunya di-quote,
  // sehingga koma di kolom lain menggeser seluruh kolom. Nilai yang diawali
  // = + - @ juga dieksekusi sebagai formula oleh Excel -> prefix apostrof.
  const cell=(v)=>{
    let s=String(v??'');
    if(/^[=+\-@\t\r]/.test(s)) s="'"+s;
    return '"'+s.replace(/"/g,'""')+'"';
  };
  const rows=DB.map(x=>[x.noService,x.tanggal,x.nama,x.telp,x.merk,x.tipe,x.keluhan,x.biaya,x.status,x.teknisi].map(cell).join(','));
  // BOM UTF-8 supaya karakter Indonesia tidak jadi berantakan di Excel.
  return '\uFEFF'+h.map(cell).join(',')+'\n'+rows.join('\n');
}
function download(name, content, type='text/plain'){
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click();
}
$('btnExportCSV').onclick=()=>download('data-service.csv',toCSV(),'text/csv');
$('btnExportCSV2').onclick=()=>download('data-service.csv',toCSV(),'text/csv');
$('btnBackup').onclick=()=>download('backup-servishp.json',JSON.stringify({setting:SET,data:DB,spareparts:(typeof SPARE!=='undefined'?SPARE:[]),sales:(typeof SALES!=='undefined'?SALES:[]),expenses:(typeof EXPENSES!=='undefined'?EXPENSES:[]),slides:(typeof SLIDES!=='undefined'?SLIDES:[])},null,2),'application/json');
$('restoreFile').addEventListener('change',(e)=>{
  if(!needSuperAdmin()){ e.target.value=''; return; }
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=()=>{ try{ const j=JSON.parse(r.result); if(j.data){DB=j.data;} else if(Array.isArray(j)){DB=j;} if(j.setting){SET=j.setting;} try{ if(j.spareparts&&typeof SPARE!=='undefined'){SPARE=j.spareparts; saveSpareLocal();} }catch{} try{ if(j.sales&&typeof SALES!=='undefined'){SALES=j.sales; saveSalesLocal();} }catch{} try{ if(j.expenses&&typeof EXPENSES!=='undefined'){EXPENSES=j.expenses; saveExpensesLocal();} }catch{} try{ if(j.slides&&typeof SLIDES!=='undefined'){SLIDES=j.slides; saveSlidesLocal();} }catch{} saveData(); saveSetting(); renderAll(); toast('Restore berhasil ✅'); }catch{ toast('File tidak valid!'); } };
  r.readAsText(f);
});

// ===== PENGATURAN =====
let SETTINGS_DIRTY = false;
function fillTeknisi(sel, val){
  if(!sel) return;
  // Pertahankan pilihan yang sedang aktif supaya tidak reset ke "Andi"
  // setiap kali halaman di-render ulang di tengah user mengisi form.
  const keep = (val!==undefined && val!==null && val!=='') ? val : (sel.value||'');
  const list = SET.teknisi||[];
  sel.innerHTML = list.map(t=>`<option ${String(t)===String(keep)?'selected':''}>${esc(t)}</option>`).join('');
  if(keep && !list.some(t=>String(t)===String(keep))){
    // pilihan lama tidak ada di daftar -> tampilkan sebagai opsi tambahan
    sel.insertAdjacentHTML('beforeend', `<option selected>${esc(keep)}</option>`);
  }
}
function renderSettingUI(){
  $('brandName').textContent=String(SET.nama||'').trim()||'ServisHP Pro';
  $('sideKonter').textContent=SET.nama; $('sideKonterAlamat').textContent=SET.alamat;
  // Jangan menimpa isian form yang sedang diedit user (renderAll() dipanggil
  // setiap kali ada sync dari server -> ketikan user hilang).
  if(!SETTINGS_DIRTY){
    $('s_nama').value=SET.nama; $('s_alamat').value=SET.alamat; $('s_telp').value=SET.telp; $('s_nota').value=SET.nota;
  }
  fillTeknisi($('f_teknisi')); fillTeknisi($('e_teknisi'));
  $('listMerk').innerHTML=(SET.merk||[]).map(m=>`<option value="${esc(m)}">`).join('');
  $('teknisiList').innerHTML=(SET.teknisi||[]).map((t,i)=>`<span class="pill">${esc(t)}<button onclick="delTeknisi(${i})">✕</button></span>`).join('');
  $('merkList').innerHTML=(SET.merk||[]).map((m,i)=>`<span class="pill">${esc(m)}<button onclick="delMerk(${i})">✕</button></span>`).join('');
}
// Tandai form pengaturan "berubah" saat user mengetik, supaya render tidak menimpa.
['s_nama','s_alamat','s_telp','s_nota'].forEach(function(id){
  const el=$(id); if(!el) return;
  el.addEventListener('input', ()=>{ SETTINGS_DIRTY=true; });
});
$('btnSaveSetting').onclick=async ()=>{
  if(!needAdmin()) return;
  const payload={ nama:$('s_nama').value||SET.nama, alamat:$('s_alamat').value, telp:$('s_telp').value, nota:$('s_nota').value };
  if(useBackend()){
    try{ await window.API.updateSettings(payload); SETTINGS_DIRTY=false; await pullSettings(); renderSettingUI(); toast('Pengaturan disimpan ✅'); return; }
    catch(err){ toast('Backend gagal: '+err.message); return; }
  }
  Object.assign(SET, payload);
  SETTINGS_DIRTY=false; saveSetting(); renderSettingUI(); toast('Pengaturan disimpan ✅');
};
$('btnAddTeknisi').onclick=async ()=>{ if(!needAdmin()) return; const v=$('newTeknisi').value.trim(); if(!v) return;
  if(useBackend()){ try{ await window.API.addTeknisi(v); $('newTeknisi').value=''; await pullSettings(); renderSettingUI(); return; }catch(err){ toast('Backend gagal: '+err.message); return; } }
  SET.teknisi.push(v); $('newTeknisi').value=''; saveSetting(); renderSettingUI(); };
$('btnAddMerk').onclick=async ()=>{ if(!needAdmin()) return; const v=$('newMerk').value.trim(); if(!v) return;
  if(useBackend()){ try{ await window.API.addMerk(v); $('newMerk').value=''; await pullSettings(); renderSettingUI(); return; }catch(err){ toast('Backend gagal: '+err.message); return; } }
  SET.merk.push(v); $('newMerk').value=''; saveSetting(); renderSettingUI(); };
window.delTeknisi=async (i)=>{ if(!needAdmin()) return;
  if(useBackend()){ try{ await window.API.delTeknisi(i); await pullSettings(); renderSettingUI(); return; }catch(err){ toast('Backend gagal: '+err.message); return; } }
  SET.teknisi.splice(i,1); saveSetting(); renderSettingUI(); };
window.delMerk=async (i)=>{ if(!needAdmin()) return;
  if(useBackend()){ try{ await window.API.delMerk(i); await pullSettings(); renderSettingUI(); return; }catch(err){ toast('Backend gagal: '+err.message); return; } }
  SET.merk.splice(i,1); saveSetting(); renderSettingUI(); };
// ===== HEADBAR SLIDER =====
function visibleSlides(){ return (SLIDES||[]).filter(s=>s.aktif!==false); }
function goHead(i){
  const list=visibleSlides(); if(!list.length) return;
  headIdx=(i+list.length)%list.length;
  const track=$('headSlides'); if(track) track.style.transform=`translateX(-${headIdx*100}%)`;
  const dots=$('headDots');
  if(dots) dots.innerHTML=list.map((_,d)=>`<button class="${d===headIdx?'on':''}" data-dot="${d}"></button>`).join('');
  if(dots) dots.querySelectorAll('button').forEach(b=>b.onclick=()=>{ goHead(Number(b.dataset.dot)); restartHeadAuto(); });
}
function restartHeadAuto(){
  if(headTimer){ clearInterval(headTimer); headTimer=null; }
  if(visibleSlides().length>1){ headTimer=setInterval(()=>goHead(headIdx+1), 4000); }
}
function renderHeadbar(){
  const track=$('headSlides'); if(!track) return;
  const list=visibleSlides();
  if(!list.length){
    track.innerHTML=`<div class="headbar-slide"><div class="headbar-empty">🖼️ Belum ada slide — tambah dari Pengaturan › Headbar Slide</div></div>`;
    const dots=$('headDots'); if(dots) dots.innerHTML='';
    return;
  }
  if(headIdx>=list.length) headIdx=0;
  track.innerHTML=list.map(s=>{
    const img=safeUrl(fullImageUrl(s.image_url), true);
    // URL gambar masuk ke context CSS -> escape dulu supaya tidak bisa
    // keluar dari url("...") dan menyuntik properti CSS lain.
    const bg=img?`background-image:url("${cssUrl(img)}")`:'background:linear-gradient(135deg,#2563eb,#7c3aed)';
    const inner=`<div class="shade"></div><div class="cap"><h2>${esc(s.judul||'Promo')}</h2><p>${esc(s.subjudul||'')}</p></div>`;
    const href=safeUrl(s.link);
    return href
      ? `<a class="headbar-slide" style="${bg}" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`
      : `<div class="headbar-slide" style="${bg}">${inner}</div>`;
  }).join('');
  goHead(headIdx); restartHeadAuto();
}
if($('headPrev')) $('headPrev').onclick=()=>{ goHead(headIdx-1); restartHeadAuto(); };
if($('headNext')) $('headNext').onclick=()=>{ goHead(headIdx+1); restartHeadAuto(); };
(function headSwipe(){
  const hb=$('headbar'); if(!hb) return;
  let sx=null;
  hb.addEventListener('touchstart',e=>{ sx=e.touches[0].clientX; },{passive:true});
  hb.addEventListener('touchend',e=>{
    if(sx===null) return;
    const dx=e.changedTouches[0].clientX-sx;
    if(Math.abs(dx)>40) goHead(headIdx+(dx<0?1:-1));
    sx=null; restartHeadAuto();
  },{passive:true});
})();
async function refreshSlideManager(){
  if(useBackend()){
    try{
      const all=await window.API.listAllSlides();
      SLIDES=all; saveSlidesLocal(); renderHeadbar(); renderSlideManager(); return;
    }catch(e){ console.warn('refreshSlideManager gagal:', e.message); }
  }
  renderSlideManager();
}
function renderSlideManager(){
  const box=$('slideList'); if(!box) return;
  const canEdit=isAdminUp();
  box.innerHTML=(SLIDES||[]).map((s,i)=>`<span class="pill">${s.aktif===false?'🚫 ':''}${esc(s.judul||('Slide '+(i+1)))}${s.image_url?' 🖼':''}
    ${canEdit?`<button onclick="toggleSlide(${jsStr(s.id!==undefined?s.id:i)},${i})" title="Aktif/Nonaktif">👁</button><button onclick="delSlide(${jsStr(s.id!==undefined?s.id:i)},${i})">✕</button>`:''}</span>`).join('')
    || '<small class="muted">Belum ada slide.</small>';
}
// Slide lokal (dibuat saat offline) ditandai _local. Tanpa penanda ini, id
// lokal yang berupa angka ikut dikirim ke server -> 404 dan slide tidak
// bisa dihapus / dimatikan.
const isLocalSlide=(s)=> !!(s && (s._local===true || s._local===1));
window.toggleSlide=async (id, idx)=>{
  if(!needAdmin()) return;
  const s=(SLIDES||[])[idx];
  if(useBackend() && s && !isLocalSlide(s) && typeof s.id==='number'){
    try{ await window.API.updateSlide(s.id,{aktif:!(s.aktif!==false)}); await refreshSlideManager(); return; }
    catch(err){ toast('Backend gagal: '+err.message); return; }
  }
  if(!s) return; s.aktif=!(s.aktif!==false); saveSlidesLocal(); renderHeadbar(); renderSlideManager();
};
window.delSlide=async (id, idx)=>{
  if(!needAdmin()) return;
  if(!confirm('Hapus slide ini?')) return;
  const s=(SLIDES||[])[idx];
  if(useBackend() && s && !isLocalSlide(s) && typeof s.id==='number'){
    try{ await window.API.deleteSlide(s.id); await refreshSlideManager(); toast('Slide dihapus'); return; }
    catch(err){ toast('Backend gagal: '+err.message); return; }
  }
  SLIDES.splice(idx,1); saveSlidesLocal(); renderHeadbar(); renderSlideManager(); toast('Slide dihapus');
};
if($('btnAddSlide')) $('btnAddSlide').onclick=async ()=>{
  if(!needAdmin()) return;
  const judul=$('sl_judul').value.trim(), subjudul=$('sl_sub').value.trim(), image_url=$('sl_url').value.trim();
  if(!judul && !image_url){ toast('Isi judul atau gambar dulu'); return; }
  if(useBackend()){
    try{
      const all=await window.API.listAllSlides().catch(()=>SLIDES);
      await window.API.createSlide({judul, subjudul, image_url, urutan:(all||[]).length, aktif:true});
      $('sl_judul').value=''; $('sl_sub').value=''; $('sl_url').value='';
      const pv=$('slidePreview'); if(pv) pv.classList.add('hidden');
      await refreshSlideManager(); toast('Slide ditambahkan ✅'); return;
    }catch(err){ toast('Backend gagal: '+err.message); return; }
  }
        SLIDES.push({id:Date.now(), _local:true, judul, subjudul, image_url, urutan:SLIDES.length, aktif:true});
  saveSlidesLocal(); $('sl_judul').value=''; $('sl_sub').value=''; $('sl_url').value='';
  renderHeadbar(); renderSlideManager(); toast('Slide ditambahkan ✅');
};
if($('sl_file')) $('sl_file').addEventListener('change', async (e)=>{
  const f=e.target.files[0]; if(!f) return;
  if(f.size>3*1024*1024){ toast('Maksimal 3MB'); e.target.value=''; return; }
  // preview lokal langsung
  const rd=new FileReader();
  rd.onload=()=>{ const pv=$('slidePreview'); if(pv){ pv.classList.remove('hidden'); pv.innerHTML=`<b>Preview:</b><br><img src="${rd.result}" style="max-width:100%;border-radius:10px;margin-top:6px"/>`; } };
  rd.readAsDataURL(f);
  if(useBackend()){
    try{
      toast('Mengupload...');
      const r=await window.API.uploadSlide(f);
      $('sl_url').value=r.url;
      toast('Upload OK ✅');
    }catch(err){ toast('Upload gagal: '+err.message); }
  } else {
    // offline: simpan sebagai dataURL (tetap tampil di HP ini)
    rd.onloadend=()=>{ if(rd.result) $('sl_url').value=String(rd.result); };
  }
  e.target.value='';
});
$('btnHapusSelesai').onclick=async ()=>{
  if(!needAdmin()) return;
  if(!confirm('Hapus semua data berstatus Diambil?')) return;
  if(useBackend() && window.API.purgeServices){
    try{
      const r = await window.API.purgeServices('diambil');
      await pullServices(); renderAll();
      toast((r && r.deleted ? r.deleted : 0)+' data selesai dihapus dari server ✅');
      return;
    }catch(err){ toast('Gagal hapus: '+err.message); return; }
  }
  DB=DB.filter(x=>normStatus(x.status)!=='Diambil'); saveData(); renderAll(); toast('Data selesai dihapus');
};
$('btnHapusSemua').onclick=async ()=>{
  if(!needSuperAdmin()) return;
  if(!confirm('HAPUS SEMUA DATA? Tindakan ini tidak bisa dibatalkan!')) return;
  if(!confirm('Yakin 100%? Ketik OK untuk lanjut.') ) return;
  if(useBackend() && window.API.purgeServices){
    try{
      const r = await window.API.purgeServices('all');
      await pullServices(); renderAll();
      toast((r && r.deleted ? r.deleted : 0)+' data dihapus dari server ✅');
      return;
    }catch(err){ toast('Gagal hapus: '+err.message); return; }
  }
  DB=[]; saveData(); renderAll(); toast('Semua data dihapus');
};

// ===== SEED CONTOH (pertama kali) =====
if(!localStorage.getItem('servishp_seeded')){
  DB=[
    {id:1,noService:'SVC-2026-0001',tanggal:new Date().toISOString().slice(0,10),nama:'Budi Santoso',telp:'08123456789',alamat:'Jl. Melati No.5',merk:'Samsung',tipe:'Galaxy A12',warna:'Hitam',imei:'',sandi:'1234',kelengkapan:['HP Saja','Charger'],keluhan:'LCD pecah, sentuh sebagian tidak respon',kondisi:'Lecet pemakaian',teknisi:'Andi',biaya:350000,dp:100000,estimasi:new Date(Date.now()+3*864e5).toISOString().slice(0,10),catatan:'Ganti LCD original',status:'Dikerjakan',riwayat:[{t:new Date().toISOString(),s:'Dikerjakan'}]},
    {id:2,noService:'SVC-2026-0002',tanggal:new Date().toISOString().slice(0,10),nama:'Siti Aminah',telp:'08234567890',alamat:'Jl. Kenanga No.3',merk:'Xiaomi',tipe:'Redmi 12C',warna:'Biru',imei:'',sandi:'-',kelengkapan:['HP Saja'],keluhan:'Baterai ngedrop, cepat panas',kondisi:'Mulus',teknisi:'Budi',biaya:150000,dp:0,estimasi:new Date(Date.now()+2*864e5).toISOString().slice(0,10),catatan:'',status:'Dikerjakan',riwayat:[{t:new Date().toISOString(),s:'Dikerjakan'}]}
  ];
  saveData(); localStorage.setItem('servishp_seeded','1');
}

// ===== AUTH UI WIRING =====
function switchAuthTab(which){
  const isLogin = which==='login';
  $('tabLogin').classList.toggle('active', isLogin);
  $('tabRegister').classList.toggle('active', !isLogin);
  $('loginForm').classList.toggle('hidden', !isLogin);
  $('registerForm').classList.toggle('hidden', isLogin);
}
$('tabLogin').onclick=()=>switchAuthTab('login');
$('tabRegister').onclick=()=>switchAuthTab('register');
document.querySelectorAll('.pw-eye').forEach(b=>b.onclick=()=>{
  const i=$(b.dataset.eye); i.type = i.type==='password'?'text':'password';
});
$('btnForgot').onclick=async ()=>{
  const id=$('l_id').value.trim();
  if(!id){ toast('Isi email / No. HP dulu untuk reset'); return; }
  if(BACKEND_OK && window.API){
    // Reset password lewat endpoint publik sudah dinonaktifkan di backend
    // (bisa dipakai siapa pun untuk membajak akun). Jadi di mode server,
    // arahkan pengguna ke Super Admin.
    toast('Reset password dilakukan oleh Super Admin. Hubungi Super Admin konter untuk reset password Anda.', 6000);
    return;
  }
  // Mode offline (LocalStorage) — masih bisa reset lokal.
  const np=prompt('Reset password (mode offline/lokal).\nMasukkan password baru (min. 6):');
  if(!np) return;
  if(np.length<6){ toast('Password minimal 6 karakter'); return; }
  const users=loadUsers();
  const u=users.find(x=>normEmail(x.email)===normEmail(id)||normPhone(x.hp)===normPhone(id));
  if(!u){ toast('Akun tidak ditemukan'); return; }
  u.pw=hashPw(np); saveUsers(users); toast('Password berhasil direset ✅ Silakan login');
};
$('loginForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const id=$('l_id').value.trim(), pw=$('l_pw').value, remember=$('l_remember').checked;
  if(!id||!pw){ toast('Isi email/No. HP + password'); return; }
  if(BACKEND_OK && window.API){
    try{
      const r = await window.API.login(id, pw, remember);
      window.API.setToken(r.access_token, remember);
      ME_CACHE = r.user;
      setSession(r.user.id, remember);
      showApp(r.user); initTanggal();
      await refreshFromBackend(); renderAll();
      toast('Selamat datang, '+String(r.user.nama||'').split(' ')[0]+'! 👋');
      return;
    }catch(err){ toast(err.message+' ❌'); return; }
  }
  const users=loadUsers();
  const u = isEmail(id)
    ? users.find(x=>normEmail(x.email)===normEmail(id))
    : users.find(x=>normPhone(x.hp)===normPhone(id)||normEmail(x.email)===normEmail(id));
  if(!u||u.pw!==hashPw(pw)){ toast('Email/No. HP atau password salah ❌'); return; }
  ME_CACHE=u;
  setSession(u.id, remember);
  showApp(u); initTanggal(); renderAll();
  toast('Selamat datang, '+u.nama.split(' ')[0]+'! 👋');
});
$('registerForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const nama=$('r_nama').value.trim(), email=normEmail($('r_email').value), hp=normPhone($('r_hp').value),
        pw=$('r_pw').value, pw2=$('r_pw2').value;
  // Pendaftaran PUBLIK selalu jadi role kasir. Meminta role lain dari form
  // publik berarti siapa pun bisa daftar jadi Super Admin.
  const role='kasir';
  if(!nama){ toast('Nama wajib diisi'); return; }
  if(!email && !hp){ toast('Isi minimal email ATAU nomor HP'); return; }
  if(email && !isEmail(email)){ toast('Format email tidak valid'); return; }
  if(hp && !/^[0-9+]{9,15}$/.test(hp)){ toast('Nomor HP tidak valid (9-15 digit)'); return; }
  if(pw.length<6){ toast('Password minimal 6 karakter'); return; }
  if(pw!==pw2){ toast('Konfirmasi password tidak sama'); return; }
  if(BACKEND_OK && window.API){
    try{
      const r = await window.API.register(nama, email||null, hp||null, pw, role);
      window.API.setToken(r.access_token, true);
      ME_CACHE=r.user; setSession(r.user.id, true);
      e.target.reset(); showApp(r.user); initTanggal();
      await refreshFromBackend(); renderAll();
      toast('Akun '+roleLabel(role)+' berhasil dibuat 🎉');
      return;
    }catch(err){ toast(err.message); return; }
  }
  const users=loadUsers();
  if(email && users.some(x=>x.email && normEmail(x.email)===email)){ toast('Email sudah terdaftar, silakan login'); switchAuthTab('login'); return; }
  if(hp && users.some(x=>x.hp && normPhone(x.hp)===hp)){ toast('No. HP sudah terdaftar, silakan login'); switchAuthTab('login'); return; }
  const u={id:Date.now(), nama, email, hp, pw:hashPw(pw), role, created:new Date().toISOString()};
  users.push(u); saveUsers(users);
  ME_CACHE=u; setSession(u.id, true);
  e.target.reset(); showApp(u); initTanggal(); renderAll();
  toast('Akun '+roleLabel(role)+' berhasil dibuat 🎉');
});
// ===== MANAJEMEN PENGGUNA (Super Admin, backend-first) =====
let CACHED_USERS = null;
async function fetchUsers(){
  if(useBackend()){
    try{ const list = await window.API.listUsers(); CACHED_USERS = list; return list; }
    catch(e){ console.warn('fetchUsers backend gagal:', e.message); }
  }
  CACHED_USERS = loadUsers();
  return CACHED_USERS;
}
function renderUsers(){
  if(!$('userTable')) return;
  const paint=(users)=>{
    const me=currentUser();
    $('userCount').textContent=users.length;
    const kas=users.filter(u=>u.role==='kasir').length, adm=users.filter(u=>u.role==='admin').length, sup=users.filter(u=>u.role==='superadmin').length;
    $('userTable').innerHTML=(users.map(u=>`<tr>
        <td><b>${esc(u.nama)}</b>${me&&u.id===me.id?' <small class="muted">(saya)</small>':''}<br><small class="muted">${(u.created||u.created_at)?fmtTgl(u.created||u.created_at):''}</small></td>
        <td><small>${esc(u.email||'-')}<br>${esc(u.hp||'-')}</small></td>
        <td>${roleBadge(u.role||'kasir')}<br><small class="muted">${kas} kasir • ${adm} admin • ${sup} super</small></td>
        <td><div class="act-btns">
          <select class="role-select" onchange="changeRole(${u.id},this.value)" ${me&&u.id===me.id?'disabled title="Tidak bisa ubah role sendiri"':''}>
            ${['kasir','admin','superadmin'].map(r=>`<option value="${r}" ${(u.role||'kasir')===r?'selected':''}>${ROLES[r].icon} ${ROLES[r].label}</option>`).join('')}
          </select>
          <button class="icon-btn" onclick="resetUserPw(${jsStr(u.id)})" title="Reset password">🔑</button>
          <button class="icon-btn" onclick="deleteUser(${jsStr(u.id)})" title="Hapus">🗑</button>
        </div></td></tr>`).join('')||'<tr><td colspan="4">Belum ada pengguna</td></tr>');
  };
  // Endpoint /api/users hanya boleh diakses Super Admin. Memanggilnya untuk
  // semua role bikin satu request sia-sia (403) tiap render + tabel menampilkan
  // data lokal palsu. Jadi hanya superadmin yang menarik dari server.
  if(useBackend() && isSuperAdmin()){
    window.API.listUsers().then(paint).catch(()=>paint(loadUsers()));
  } else {
    paint(loadUsers());
  }
}
$('btnAddUser').onclick=async ()=>{
  if(!needSuperAdmin()) return;
  const nama=$('u_nama').value.trim(), email=normEmail($('u_email').value), hp=normPhone($('u_hp').value),
        pw=$('u_pw').value, role=$('u_role').value||'kasir';
  if(!nama||!pw){ toast('Nama + password wajib'); return; }
  if(!email&&!hp){ toast('Isi email atau HP'); return; }
  if(email&&!isEmail(email)){ toast('Email tidak valid'); return; }
  if(pw.length<6){ toast('Password min. 6'); return; }
  if(useBackend()){
    try{ await window.API.createUser({nama, email:email||null, hp:hp||null, password:pw, role});
      $('u_nama').value='';$('u_email').value='';$('u_hp').value='';$('u_pw').value='';
      renderUsers(); toast(roleLabel(role)+' ditambahkan ✅'); return; }
    catch(err){ toast(err.message); return; }
  }
  const users=loadUsers();
  if(email&&users.some(x=>x.email&&normEmail(x.email)===email)){ toast('Email sudah dipakai'); return; }
  if(hp&&users.some(x=>x.hp&&normPhone(x.hp)===hp)){ toast('HP sudah dipakai'); return; }
  users.push({id:Date.now(), nama, email, hp, pw:hashPw(pw), role, created:new Date().toISOString()});
  saveUsers(users); $('u_nama').value='';$('u_email').value='';$('u_hp').value='';$('u_pw').value='';
  renderUsers(); toast(roleLabel(role)+' ditambahkan ✅');
};
window.changeRole=async function(id, newRole){
  if(!needSuperAdmin()){ renderUsers(); return; }
  if(useBackend()){
    try{ const u = await window.API.changeRole(id, newRole); renderUsers(); toast(u.nama+' → '+roleLabel(newRole)); }
    catch(err){ toast(err.message); renderUsers(); }
    return;
  }
  const users=loadUsers(); const u=users.find(x=>x.id===id); if(!u) return;
  const me=currentUser();
  if(me&&u.id===me.id){ toast('Tidak bisa ubah role sendiri'); renderUsers(); return; }
  if(u.role==='superadmin'&&newRole!=='superadmin'&&users.filter(x=>x.role==='superadmin').length<=1){ toast('⛔ Minimal 1 Super Admin harus ada'); renderUsers(); return; }
  u.role=newRole; saveUsers(users); renderUsers(); toast(u.nama+' → '+roleLabel(newRole));
};
window.deleteUser=async function(id){
  if(!needSuperAdmin()) return;
  if(useBackend()){
    try{
      const list = CACHED_USERS || await fetchUsers();
      const u = (list||[]).find(x=>x.id===id);
      if(u && !confirm('Hapus pengguna '+u.nama+' ('+roleLabel(u.role||'kasir')+')?')) return;
      await window.API.deleteUser(id); renderUsers(); toast('Pengguna dihapus'); return;
    }catch(err){ toast(err.message); return; }
  }
  const users=loadUsers(); const u=users.find(x=>x.id===id); if(!u) return;
  const me=currentUser();
  if(me&&u.id===me.id){ toast('Tidak bisa hapus akun sendiri'); return; }
  if(u.role==='superadmin'&&users.filter(x=>x.role==='superadmin').length<=1){ toast('⛔ Tidak bisa hapus satu-satunya Super Admin'); return; }
  if(!confirm('Hapus pengguna '+u.nama+' ('+roleLabel(u.role||'kasir')+')?')) return;
  saveUsers(users.filter(x=>x.id!==id)); renderUsers(); toast('Pengguna dihapus');
};
window.resetUserPw=async function(id){
  if(!needSuperAdmin()) return;
  const np=prompt('Password baru (min. 6):');
  if(!np) return;
  if(np.length<6){ toast('Min. 6 karakter'); return; }
  if(useBackend()){
    try{ await window.API.resetUserPw(id, np); toast('Password direset ✅'); return; }
    catch(err){ toast(err.message); return; }
  }
  const users=loadUsers(); const u=users.find(x=>x.id===id); if(!u) return;
  u.pw=hashPw(np); saveUsers(users); toast('Password '+u.nama+' direset ✅');
};
$('btnLogout').onclick=doLogout;
$('btnLogout2').onclick=doLogout;
$('btnGantiPw').onclick=()=>$('gantiPwBox').classList.toggle('hidden');
$('btnSavePw').onclick=async ()=>{
  const a=$('npw1').value, b=$('npw2').value;
  if(a.length<6){ toast('Password minimal 6 karakter'); return; }
  if(a!==b){ toast('Konfirmasi tidak sama'); return; }
  if(useBackend()){
    try{ await window.API.changePassword(a); $('npw1').value=''; $('npw2').value=''; $('gantiPwBox').classList.add('hidden'); toast('Password berhasil diganti ✅'); return; }
    catch(err){ toast(err.message); return; }
  }
  const users=loadUsers(); const me=currentUser(); if(!me) return;
  const u=users.find(x=>x.id===me.id); if(!u) return; u.pw=hashPw(a); saveUsers(users);
  $('npw1').value=''; $('npw2').value=''; $('gantiPwBox').classList.add('hidden');
  toast('Password berhasil diganti ✅');
};

// ===== DATA SPAREPART =====
const LS_SPARE = 'servishp_spareparts_v1';
const LS_JENIS = 'servishp_spare_jenis_v1';
let SPARE = loadSpareLocal();
// cache jenis per SKU: dipakai kalau backend belum punya kolom "jenis"
let SPARE_JENIS = loadSpareJenis();
let BACKEND_JENIS_OK = null;   // null = belum diketahui, true/false = dukung/tidak
function loadSpareJenis(){ try{ return JSON.parse(localStorage.getItem(LS_JENIS)) || {}; }catch{ return {}; } }
function saveSpareJenis(){ try{ localStorage.setItem(LS_JENIS, JSON.stringify(SPARE_JENIS)); }catch{} }
function setSpareJenis(sku, jenis){
  const k=String(sku||'').trim().toLowerCase();
  if(!k || !jenis) return;
  SPARE_JENIS[k]=jenis; saveSpareJenis();
}
// terapkan cache jenis ke data produk (backend lama tidak menyimpan kolom jenis)
function applySpareJenis(){
  (SPARE||[]).forEach(x=>{
    const k=String(x.sku||'').trim().toLowerCase();
    if(!k) return;
    const cached=SPARE_JENIS[k];
    const dariBackend=String(x.jenis||'').trim();
    if((!dariBackend || dariBackend==='Sparepart') && cached) x.jenis=cached;
    if(!x.jenis) x.jenis='Sparepart';
  });
  // NOTE: cache TIDAK di-prune di sini, karena bisa ada pull paralel
  //       yang datanya lebih lama -> entri cache ikut terhapus.
  //       Entri untuk SKU yang dihapus tetap dibersihkan di spHapus().
}
let spLowOnly = false;
let spEditId = null;
let scanStream = null;
let scanRaf = null;

function loadSpareLocal(){ try{ return JSON.parse(localStorage.getItem(LS_SPARE)) || []; }catch{ return []; } }
try{ applySpareJenis(); }catch{}
function saveSpareLocal(){ try{ localStorage.setItem(LS_SPARE, JSON.stringify(SPARE)); }catch{} }
if(!localStorage.getItem(LS_SPARE)){
  SPARE=[
    {id:1, nama:'LCD Samsung A12', sku:'LCD-SSA12', merk:'Samsung', kategori:'LCD', hpp:180000, harga_jual:250000, stok:8, stok_min:3},
    {id:2, nama:'Baterai Redmi 12C', sku:'BAT-R12C', merk:'Xiaomi', kategori:'Baterai', hpp:65000, harga_jual:95000, stok:2, stok_min:5},
    {id:3, nama:'Charger 25W USB-C', sku:'CHR-25WC', merk:'Samsung', kategori:'Charger', hpp:45000, harga_jual:75000, stok:15, stok_min:5},
    {id:4, nama:'Tempered Glass A12', sku:'ACC-TG12', merk:'Generic', kategori:'Aksesoris', jenis:'Accessories', hpp:8000, harga_jual:20000, stok:40, stok_min:10},
    {id:5, nama:'Case Silikon A12', sku:'ACC-CS12', merk:'Generic', kategori:'Aksesoris', jenis:'Accessories', hpp:12000, harga_jual:30000, stok:25, stok_min:8},
    {id:6, nama:'Nokia 105 2G', sku:'HP-NK105', merk:'Nokia', kategori:'Handphone', jenis:'Handphone', hpp:550000, harga_jual:650000, stok:6, stok_min:2},
    {id:7, nama:'Infinix Hot 30', sku:'HP-IH30', merk:'Infinix', kategori:'Handphone', jenis:'Handphone', hpp:1350000, harga_jual:1550000, stok:4, stok_min:2},
  ];
  saveSpareLocal();
}
function spKat(x){ return ((x && x.kategori) || 'Lainnya').toString().trim() || 'Lainnya'; }
// ===== JENIS PRODUK (Sparepart / Accessories / Handphone) =====
const JENIS_PRODUK = ['Sparepart','Accessories','Handphone'];
const PR_TABS = { sparepart:'Sparepart', accessories:'Accessories', handphone:'Handphone' };
let prTab='sparepart';
function spJenis(x){ return ((x && x.jenis) || 'Sparepart').toString().trim() || 'Sparepart'; }
function spJenisAktif(){ return PR_TABS[prTab] || 'Sparepart'; }
function gotoProdukTab(name){
  prTab = PR_TABS[name] ? name : 'sparepart';
  NAVLTAB.produk = prTab;
  document.querySelectorAll('#prTabs .ltab').forEach(b=>b.classList.toggle('active', b.dataset.prtab===prTab));
  try{ renderSpareparts(); }catch{}
  // Ganti jenis -> kembali ke atas supaya tabel langsung terlihat (tidak nyangkut di bawah).
  try{ window.scrollTo({top:0,behavior:'smooth'}); }catch{}
}
function spKategoriList(jenis){
  const j = jenis || spJenisAktif();
  const seen={};
  (SPARE||[]).forEach(x=>{ if(spJenis(x)!==j) return; const k=spKat(x); if(!seen[k]) seen[k]=1; });
  return Object.keys(seen).sort((a,b)=>a.toLowerCase().localeCompare(b.toLowerCase()));
}
function refreshSpKategoriUI(){
  const sel=$('spKategori'); if(!sel) return;
  const cur=sel.value||'';
  const list=spKategoriList();
  sel.innerHTML='<option value="">Semua Kategori</option>'+list.map(k=>`<option value="${esc(k)}">${esc(k)}</option>`).join('');
  if(cur && (cur==='' || list.includes(cur))) sel.value=cur;
  const dl=$('spKategoriList');
  if(dl) dl.innerHTML=list.map(k=>`<option value="${esc(k)}"></option>`).join('');
}
let SPARE_PULL_SEQ = 0;
async function pullSpareparts(){
  if(!useBackend()) return false;
  const seq = ++SPARE_PULL_SEQ;
  try{
    const list = await window.API.listSpareparts({limit:1000, sort:'nama'});
    // ada request lain yang lebih baru -> jangan timpa dengan data lama
    if(seq !== SPARE_PULL_SEQ) return false;
    const arr = Array.isArray(list) ? list : [];
    // deteksi apakah backend sudah mengembalikan kolom "jenis"
    if(arr.length) BACKEND_JENIS_OK = arr.some(x=>Object.prototype.hasOwnProperty.call(x||{}, 'jenis'));
    SPARE = arr;
    applySpareJenis();
    saveSpareLocal(); renderSpareparts();
    return true;
  }catch(e){ console.warn('pullSpareparts gagal:', e.message); return false; }
}
function spMargin(x){
  const hpp=Number(x.hpp||0), jual=Number(x.harga_jual||0);
  if(!hpp) return jual>0 ? '+100%' : '-';
  return '+' + Math.round((jual-hpp)/hpp*100) + '%';
}
function renderSpareparts(){
  if(!$('spTable')) return;
  refreshSpKategoriUI();
  const q=(($('spSearch') && $('spSearch').value)||'').toLowerCase().trim();
  const fk=(($('spKategori') && $('spKategori').value)||'').trim();
  const jenis=spJenisAktif();
  // produk di tab aktif (jenis), sisanya untuk stat
  const pool=SPARE.filter(x=>spJenis(x)===jenis);
  let r=[...pool];
  if(fk) r=r.filter(x=>spKat(x).toLowerCase()===fk.toLowerCase());
  if(spLowOnly) r=r.filter(x=>Number(x.stok||0)<=Number(x.stok_min||0));
  if(q) r=r.filter(x=>[(x.nama||''),(x.sku||''),(x.merk||''),spKat(x)].join(' ').toLowerCase().includes(q));
  const s=$('spSort') ? $('spSort').value : 'nama';
  if(s==='sku') r.sort((a,b)=>String(a.sku||'').localeCompare(String(b.sku||'')));
  else if(s==='stok') r.sort((a,b)=>Number(a.stok||0)-Number(b.stok||0));
  else r.sort((a,b)=>String(a.nama||'').localeCompare(String(b.nama||'')));
  const low=pool.filter(x=>Number(x.stok||0)<=Number(x.stok_min||0)).length;
  const nilai=pool.reduce((a,b)=>a+Number(b.hpp||0)*Number(b.stok||0),0);
  // Label jenis aktif -> jelas sedang menampilkan kategori yang dipilih saja.
  const LABEL_JENIS={Sparepart:'🔧 Stok Sparepart', Accessories:'🎧 Stok Accessories', Handphone:'📱 Stok Handphone'};
  const labelJ=LABEL_JENIS[jenis]||jenis;
  if($('spTotal')) $('spTotal').textContent=pool.length;
  if($('spNilai')) $('spNilai').textContent=fmtRp(nilai);
  if($('spLow')) $('spLow').textContent=low;
  if($('spCount')) $('spCount').textContent=pool.length+' item';
  if($('spInfo')) $('spInfo').textContent = spLowOnly ? `• menampilkan ${r.length} stok menipis` : (low?`• ${low} stok menipis`:'' );
  if($('spJenisLabel')) $('spJenisLabel').textContent=labelJ;
  if($('emptySpare')){
    $('emptySpare').innerHTML=`Belum ada produk <b>${esc(jenis)}</b> di kategori ini.`
      + (isAdminUp()?` <button class="btn small primary" onclick="openSpareModal()">+ Input ${esc(jenis)}</button>`:'');
    $('emptySpare').classList.toggle('hidden', r.length>0);
  }
  // Kasir boleh lihat + ubah stok, tapi TIDAK boleh tambah/edit/hapus sparepart
  const admin=isAdminUp();
  const bAdd=$('btnAddSpare');
  if(bAdd) bAdd.style.display=admin?'':'none';
  if(!r.length){ $('spTable').innerHTML=''; return; }
  $('spTable').innerHTML=r.map(x=>{
    const isLow=Number(x.stok||0)<=Number(x.stok_min||0);
    const sid=esc(String(x.id));
    return `<tr>
      <td><b>${esc(x.sku)}</b></td>
      <td><b>${esc(x.nama)}</b><br><small class="muted">Margin: ${esc(spMargin(x))}</small></td>
      <td>${esc(x.merk||'-')}</td>
      <td><span class="badge b-Dikerjakan">${esc(spKat(x))}</span></td>
      <td>${fmtRp(x.hpp)}</td>
      <td><b>${fmtRp(x.harga_jual)}</b></td>
      <td><b>${esc(x.stok)}</b><small class="muted"> / min ${esc(x.stok_min)}</small><br>${isLow?'<span class="badge b-Batal">Menipis</span>':'<span class="badge b-Selesai">Aman</span>'}</td>
      <td><div class="act-btns">
        <button class="icon-btn" onclick="spStock('${jsStr(sid)}',-1)" title="Kurangi 1">−</button>
        <button class="icon-btn" onclick="spStock('${jsStr(sid)}',1)" title="Tambah 1">+</button>
        ${admin?`<button class="icon-btn" onclick="spEdit('${jsStr(sid)}')" title="Edit">✏️</button>
        <button class="icon-btn" onclick="spHapus('${jsStr(sid)}')" title="Hapus">🗑</button>`:''}
      </div></td></tr>`;
  }).join('');
}
function findSpare(id){ return SPARE.find(d=>String(d.id)===String(id)); }
if($('spSearch')) $('spSearch').addEventListener('input',()=>renderSpareparts());
if($('spSort')) $('spSort').onchange=renderSpareparts;
if($('spKategori')) $('spKategori').onchange=renderSpareparts;
if($('spLowBtn')) $('spLowBtn').onclick=()=>{
  spLowOnly=!spLowOnly;
  $('spLowBtn').classList.toggle('active', spLowOnly);
  renderSpareparts();
};
function spMerk(x){ return ((x && x.merk) || '').toString().trim(); }
function spMerkList(){
  const seen={};
  (SPARE||[]).forEach(x=>{ const m=spMerk(x); if(m && !seen[m.toLowerCase()]) seen[m.toLowerCase()]=m; });
  return Object.keys(seen).map(k=>seen[k]).sort((a,b)=>a.toLowerCase().localeCompare(b.toLowerCase()));
}
// Isi dropdown modal sparepart dari data yg sudah ada (+ opsi "Baru..." via prompt)
function fillSpareSelect(sel, list, current, placeholder){
  if(!sel) return;
  sel.innerHTML='<option value="">'+esc(placeholder)+'</option>'
    +list.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('')
    +'<option value="__baru">➕ Baru...</option>';
  const cur=String(current||'').trim();
  if(!cur){ sel.value=''; return; }
  const match=list.find(v=>v.toLowerCase()===cur.toLowerCase());
  if(match!==undefined){ sel.value=match; return; }
  const o=document.createElement('option'); o.value=cur; o.textContent=cur;
  sel.insertBefore(o, sel.querySelector('option[value="__baru"]'));
  sel.value=cur;
}
function refreshSpareModalLists(curMerk, curKat, jenis){
  fillSpareSelect($('sp_merk'), spMerkList(), curMerk||'', '— Tanpa Merk —');
  fillSpareSelect($('sp_kategori'), spKategoriList(jenis||spJenisAktif()), curKat||'', '— Pilih Kategori —');
}
function bindSpareBaru(){
  [['sp_merk','merk'],['sp_kategori','kategori']].forEach(([id,kind])=>{
    const sel=$(id); if(!sel||sel.dataset.baruBound) return; sel.dataset.baruBound='1';
    sel.addEventListener('change',()=>{
      if(sel.value!=='__baru') return;
      const v=prompt('Nama '+(kind==='merk'?'merk':'kategori')+' baru:');
      const t=String(v||'').trim();
      if(!t){ sel.value=''; return; }
      const o=document.createElement('option'); o.value=t; o.textContent=t;
      sel.insertBefore(o, sel.querySelector('option[value="__baru"]'));
      sel.value=t;
    });
  });
}
try{ bindSpareBaru(); }catch{}
// isi dropdown Jenis Produk + tab di halaman Produk
try{
  if($('sp_jenis') && !$('sp_jenis').options.length){
    $('sp_jenis').innerHTML=JENIS_PRODUK.map(j=>'<option value="'+j+'">'+j+'</option>').join('');
  }
  document.querySelectorAll('#prTabs .ltab').forEach(b=>b.addEventListener('click',()=>{
    gotoProdukTab(b.dataset.prtab);
    navSyncActive('produk', b.dataset.prtab, 'produk');
  }));
  // ganti jenis produk -> daftar kategori ikut menyesuaikan
  if($('sp_jenis') && !$('sp_jenis').dataset.bound){
    $('sp_jenis').dataset.bound='1';
    $('sp_jenis').addEventListener('change',()=>{
      refreshSpareModalLists($('sp_merk')?$('sp_merk').value:'', '', $('sp_jenis').value);
    });
  }
}catch{}
function openSpareModal(){
  if(!needAdmin()) return;
  spEditId=null;
  $('spareTitle').textContent='Tambah Produk';
  $('sp_nama').value=''; $('sp_sku').value='';
  refreshSpareModalLists('', '');
  $('sp_hpp').value=0; $('sp_jual').value=0; $('sp_stok').value=0; $('sp_min').value=0;
  if($('sp_jenis')) $('sp_jenis').value=spJenisAktif();
  updSpMargin();
  $('modalSpare').classList.remove('hidden');
  setTimeout(()=>{ const el=$('sp_nama'); if(el) el.focus(); },50);
}
if($('btnAddSpare')) $('btnAddSpare').onclick=openSpareModal;
function updSpMargin(){
  const hpp=Number(($('sp_hpp')||{}).value||0), jual=Number(($('sp_jual')||{}).value||0);
  if($('spMargin')) $('spMargin').textContent = hpp>0 ? `Margin: ${fmtRp(jual-hpp)} (${(jual-hpp>=0?'+':'')+Math.round((jual-hpp)/hpp*100)}%)` : '';
}
if($('sp_hpp')) $('sp_hpp').addEventListener('input',updSpMargin);
if($('sp_jual')) $('sp_jual').addEventListener('input',updSpMargin);
window.spEdit=function(id){
  if(!needAdmin()) return;
  const x=findSpare(id); if(!x){ toast('Data tidak ditemukan'); return; } spEditId=x.id;
  $('spareTitle').textContent='Edit Produk';
  $('sp_nama').value=x.nama; $('sp_sku').value=x.sku;
  if($('sp_jenis')) $('sp_jenis').value=spJenis(x);
  refreshSpareModalLists(x.merk||'', (x.kategori||'').trim(), spJenis(x));
  $('sp_hpp').value=x.hpp||0; $('sp_jual').value=x.harga_jual||0; $('sp_stok').value=x.stok||0; $('sp_min').value=x.stok_min||0;
  updSpMargin();
  $('modalSpare').classList.remove('hidden');
};
if($('btnSaveSpare')) $('btnSaveSpare').onclick=async ()=>{
  if(!needAdmin()) return;
  const nama=$('sp_nama').value.trim(), sku=$('sp_sku').value.trim();
  let merk=(($('sp_merk')||{}).value||'').trim(); if(merk==='__baru') merk='';
  const kategori=(($('sp_kategori')||{}).value||'').trim();
  const jenis=(($('sp_jenis')||{}).value||'').trim() || 'Sparepart';
  const hpp=Number($('sp_hpp').value||0), jual=Number($('sp_jual').value||0);
  const stok=Number($('sp_stok').value||0), smin=Number($('sp_min').value||0);
  if(!nama||!sku){ toast('Nama + SKU wajib diisi'); return; }
  if(!kategori || kategori==='__baru'){ toast('Pilih kategori dulu'); return; }
  const isEdit=(spEditId!==null && spEditId!==undefined);
  if(useBackend()){
    try{
      setSpareJenis(sku, jenis);
      if(isEdit) await window.API.updateSparepart(spEditId,{nama,sku,merk,kategori,jenis,hpp,harga_jual:jual,stok,stok_min:smin});
      else await window.API.createSparepart({nama,sku,merk,kategori,jenis,hpp,harga_jual:jual,stok,stok_min:smin});
      $('modalSpare').classList.add('hidden');
      await pullSpareparts(); renderAll();
      // backend lama belum mendukung kolom "jenis" -> jenis tetap tersimpan di perangkat ini
      if(BACKEND_JENIS_OK===false && jenis!=='Sparepart'){
        toast('Produk tersimpan ✅ (jenis tersimpan di perangkat ini — server perlu update untuk sinkron)');
        return;
      }
      toast('Produk tersimpan ✅'); return;
    }catch(err){ toast(err.message); return; }
  }
  if(spEditId!==null && spEditId!==undefined){
    const x=findSpare(spEditId); if(!x){ toast('Data tidak ditemukan'); return; }
    if(SPARE.some(d=>String(d.id)!==String(spEditId)&&String(d.sku).toLowerCase()===sku.toLowerCase())){ toast('SKU sudah dipakai'); return; }
    Object.assign(x,{nama,sku,merk,kategori,jenis,hpp,harga_jual:jual,stok,stok_min:smin});
    setSpareJenis(sku, jenis);
  } else {
    if(SPARE.some(d=>String(d.sku).toLowerCase()===sku.toLowerCase())){ toast('SKU sudah dipakai'); return; }
    SPARE.push({id:Date.now(),nama,sku,merk,kategori,jenis,hpp,harga_jual:jual,stok,stok_min:smin});
    setSpareJenis(sku, jenis);
  }
  saveSpareLocal();
  $('modalSpare').classList.add('hidden');
  renderAll(); toast('Produk tersimpan ✅');
};
window.spHapus=async function(id){
  if(!needAdmin()) return;
  const x=findSpare(id); if(!x){ toast('Data tidak ditemukan'); return; }
  if(!confirm('Hapus '+x.nama+' ('+x.sku+')?')) return;
  if(useBackend()){
    try{ await window.API.deleteSparepart(x.id); await pullSpareparts(); renderAll(); toast('Produk dihapus'); return; }
    catch(err){ toast(err.message); return; }
  }
  SPARE=SPARE.filter(d=>String(d.id)!==String(x.id));
  try{ const k=String(x.sku||'').trim().toLowerCase(); if(k){ delete SPARE_JENIS[k]; saveSpareJenis(); } }catch{}
  saveSpareLocal(); renderAll(); toast('Produk dihapus');
};
window.spStock=async function(id, delta){
  const x=findSpare(id); if(!x){ toast('Data tidak ditemukan'); return; }
  if(useBackend()){
    try{ await window.API.adjustStock(x.id, delta); await pullSpareparts(); renderAll(); return; }
    catch(err){ toast(err.message); return; }
  }
  if(Number(x.stok||0)+delta<0){ toast('Stok tidak boleh minus'); return; }
  x.stok=Number(x.stok||0)+delta; saveSpareLocal(); renderAll();
};
// ===== SCAN SKU (kamera, tanpa library) =====
// target 'sku' = isi field SKU form sparepart, target 'jual' = langsung masuk keranjang kasir
let scanTarget = 'sku';
if($('btnScanSku')) $('btnScanSku').onclick=()=>openScan('sku');
if($('btnScanJual')) $('btnScanJual').onclick=()=>openScan('jual');
async function openScan(target){
  scanTarget = (target==='jual') ? 'jual' : 'sku';
  $('modalScan').classList.remove('hidden');
  const st=$('scanStatus'), video=$('scanVideo');
  const stop=()=>closeScan();
  if(!('BarcodeDetector' in window)){
    if(st) st.textContent='⚠️ Browser HP ini tidak mendukung scan kamera. Ketik SKU manual ya.';
    return;
  }
  try{
    if(st) st.textContent='Membuka kamera...';
    scanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
    video.srcObject=scanStream;
    await video.play();
    const det=new BarcodeDetector({formats:['qr_code','code_128','code_39','ean_13','ean_8','upc_a','upc_e','itf','codabar']});
    if(st) st.textContent='Arahkan kamera ke barcode / QR SKU...';
    const loop=async ()=>{
      if(video.readyState===video.HAVE_ENOUGH_DATA){
        try{
          const codes=await det.detect(video);
          if(codes && codes.length){
            const v=codes[0].rawValue||'';
            if(v){
              stop();
              if(scanTarget==='jual'){ scanJualAdd(v); }
              else { $('sp_sku').value=v; toast('SKU: '+v+' ✅'); tryLookupSku(v); }
              return;
            }
          }
        }catch{}
      }
      scanRaf=requestAnimationFrame(loop);
    };
    loop();
  }catch(e){ if(st) st.textContent='❌ Kamera tidak bisa dibuka: '+e.message; }
}
function closeScan(){
  if(scanRaf){ cancelAnimationFrame(scanRaf); scanRaf=null; }
  if(scanStream){ scanStream.getTracks().forEach(t=>t.stop()); scanStream=null; }
  const v=$('scanVideo'); if(v){ v.pause(); v.srcObject=null; }
  $('modalScan').classList.add('hidden');
}
async function tryLookupSku(sku){
  // kalau SKU sudah terdaftar, langsung buka edit-nya
  const found=SPARE.find(d=>String(d.sku).toLowerCase()===String(sku).toLowerCase());
  if(found){ toast(found.nama+' • stok '+found.stok); return; }
  if(useBackend()){
    try{ const x=await window.API.getBySku(sku); toast(x.nama+' • stok '+x.stok); await pullSpareparts(); }
    catch{}
  }
}
// Hasil scan di kasir penjualan: SKU cocok -> langsung masuk keranjang
async function scanJualAdd(sku){
  const code=String(sku||'').trim();
  if(!code) return;
  let found=(typeof SPARE!=='undefined'?SPARE:[]).find(d=>String(d.sku||'').toLowerCase()===code.toLowerCase());
  if(!found && useBackend()){
    try{ await window.API.getBySku(code); await pullSpareparts(); }catch{}
    found=(typeof SPARE!=='undefined'?SPARE:[]).find(d=>String(d.sku||'').toLowerCase()===code.toLowerCase());
  }
  if(found){
    toast('SKU: '+code+' ✅');
    if(typeof jualAddBarang==='function') jualAddBarang(found);
  } else {
    // tidak dikenal -> tampilkan di kolom cari agar kasir bisa lihat / ketik manual
    if($('j_search')){ $('j_search').value=code; $('j_search').dispatchEvent(new Event('input')); }
    toast('SKU '+code+' tidak ada di stok ❌');
  }
}
document.querySelectorAll('#modalScan [data-close]').forEach(b=>b.addEventListener('click',()=>closeScan()));

// ===== BACKEND UI: tes koneksi & simpan URL =====
if($('btnTestBackend')) $('btnTestBackend').onclick=async ()=>{
  const ok = await checkBackend(false);
  if(ok && backendToken()){
    try{ const me = await window.API.me(); ME_CACHE=me; toast('Tersambung ✅ Halo, '+me.nama); }
    catch{ toast('Tersambung ke server, tapi token tidak valid — silakan login ulang'); }
  } else if(ok){ toast('Server OK ✅ Silakan login'); }
  else toast('Server offline 🔴');
};
if($('btnSaveApiBase')) $('btnSaveApiBase').onclick=async ()=>{
  const v=($('s_apiBase').value||'').trim();
  if(!v){ toast('Isi URL dulu, cth: http://192.168.1.10:8000/api'); return; }
  if(window.API && window.API.setBase) window.API.setBase(v);
  else { try{ localStorage.setItem('servishp_api_base', v.replace(/\/$/,'')); }catch{} if(window.API) window.API.base=v.replace(/\/$/,''); }
  $('s_apiBase').value = backendBase();
  await checkBackend(false);
  toast('URL API disimpan ✅');
};

// ===== PENJUALAN BARANG (retail sparepart, kasir boleh input) =====
const LS_SALE = 'servishp_sales_v1';
let SALES = loadSalesLocal();
let CART = [];
function loadSalesLocal(){ try{ return JSON.parse(localStorage.getItem(LS_SALE)) || []; }catch{ return []; } }
function saveSalesLocal(){ try{ localStorage.setItem(LS_SALE, JSON.stringify(SALES)); }catch{} }
function genNoNota(){
  const d=new Date(); const y=d.getFullYear();
  const n=SALES.filter(x=>String(x.no_nota||'').includes(String(y))).length+1;
  let no=`SL-${y}-${String(n).padStart(4,'0')}`;
  let i=n;
  while(SALES.some(x=>x.no_nota===no)){ i++; no=`SL-${y}-${String(i).padStart(4,'0')}`; }
  return no;
}
async function pullSales(){
  if(!useBackend()) return false;
  try{
    const list = await window.API.listSales({limit:1000});
    SALES = Array.isArray(list) ? list : [];
    saveSalesLocal(); renderSales();
    return true;
  }catch(e){ console.warn('pullSales gagal:', e.message); return false; }
}
function cartTotal(){ return CART.reduce((a,c)=>a+Number(c.harga||0)*Number(c.qty||0),0); }
function updKembalian(){
  const t=cartTotal();
  if($('j_total')) $('j_total').textContent=fmtRp(t);
  const bayar=Number(($('j_bayar')||{}).value||0);
  const el=$('j_kembali');
  if(el){
    // Kalau kurang bayar, jangan disembunyikan sebagai "Rp 0" — tampilkan
    // selisihnya supaya kasir melihat semua uang yang kurang.
    const kurang=bayar-t;
    el.value = kurang>=0 ? fmtRp(kurang) : ('KURANG '+fmtRp(-kurang));
    el.classList.toggle('danger-text', kurang<0);
  }
}
function renderSales(){
  if(!$('j_cart')) return;
  // tanggal default hari ini
  if($('j_tanggal') && !$('j_tanggal').value) $('j_tanggal').value=new Date().toISOString().slice(0,10);
  const omzet=SALES.reduce((a,s)=>a+Number(s.total||0),0);
  const laba=SALES.reduce((a,s)=>a+Number(s.laba||0),0);
  if($('slOmzet')) $('slOmzet').textContent=fmtRp(omzet);
  if($('slNota')) $('slNota').textContent=SALES.length;
  if($('slLaba')) $('slLaba').textContent=fmtRp(laba);
  if($('jlCount')) $('jlCount').textContent=SALES.length+' nota';
  // keranjang
  if($('j_itemCount')) $('j_itemCount').textContent=CART.reduce((a,c)=>a+Number(c.qty||0),0);
  if($('j_empty')) $('j_empty').classList.toggle('hidden', CART.length>0);
  $('j_cart').innerHTML=CART.map((c,i)=>`<tr>
    <td><b>${esc(c.nama)}</b><br><small class="muted">${esc(c.sku)} • stok ${esc(c.stok)}</small></td>
    <td>${fmtRp(c.harga)}</td>
    <td><div class="act-btns"><button class="icon-btn" onclick="cartQty(${i},-1)">−</button><b style="padding:0 6px">${esc(c.qty)}</b><button class="icon-btn" onclick="cartQty(${i},1)">+</button></div></td>
    <td><b>${fmtRp(Number(c.harga||0)*Number(c.qty||0))}</b></td>
    <td><button class="icon-btn" onclick="cartDel(${i})" title="Hapus">✕</button></td></tr>`).join('');
  updKembalian();
  // riwayat
  const q=(($('jl_search')||{}).value||'').toLowerCase().trim();
  let r=[...SALES].sort((a,b)=>(b.id||0)-(a.id||0));
  if(q) r=r.filter(x=>[x.no_nota,x.pelanggan,x.telp].join(' ').toLowerCase().includes(q));
  if($('jlInfo')) $('jlInfo').textContent = r.length===SALES.length ? (SALES.length?`Menampilkan semua (${SALES.length})`:'') : `Menampilkan ${r.length} dari ${SALES.length}`;
  if($('jl_empty')) $('jl_empty').classList.toggle('hidden', r.length>0);
  if($('jl_table')) $('jl_table').innerHTML=r.slice(0,100).map(x=>`<tr>
    <td><b>${esc(x.no_nota)}</b><br><small class="muted">${fmtTgl(x.tanggal)} • ${esc(x.metode||'Tunai')}</small></td>
    <td>${esc(x.pelanggan||'Umum')}<br><small class="muted">${esc((x.items||[]).map(i=>i.nama+' ×'+i.qty).join(', ').slice(0,60))}</small></td>
    <td><b>${fmtRp(x.total)}</b><br><small class="muted">laba ${fmtRp(x.laba)}</small></td>
    <td><div class="act-btns"><button class="icon-btn" onclick="cetakJual(${jsStr(x.id)})" title="Nota">🖨</button><button class="icon-btn" onclick="detailJual(${jsStr(x.id)})" title="Detail">👁</button>${isAdminUp()?`<button class="icon-btn" onclick="hapusJual(${jsStr(x.id)})" title="Hapus">🗑</button>`:''}</div></td></tr>`).join('');
}
window.cartQty=function(i,d){
  const c=CART[i]; if(!c) return;
  const nq=Number(c.qty||0)+d;
  if(nq<=0){ CART.splice(i,1); }
  else{
    if(nq>Number(c.stok||0)){ toast('Stok '+c.nama+' sisa '+c.stok); return; }
    c.qty=nq;
  }
  renderSales();
};
window.cartDel=function(i){ CART.splice(i,1); renderSales(); };
function jualAddBarang(sp){
  if(!sp) return;
  if(Number(sp.stok||0)<=0){ toast('Stok '+sp.nama+' habis'); return; }
  const ada=CART.find(c=>String(c.id)===String(sp.id));
  if(ada){
    if(Number(ada.qty||0)+1>Number(sp.stok||0)){ toast('Stok '+sp.nama+' sisa '+sp.stok); return; }
    ada.qty=Number(ada.qty||0)+1;
  } else {
    CART.push({id:sp.id, sku:sp.sku, nama:sp.nama, harga:sp.harga_jual||0, hpp:sp.hpp||0, stok:sp.stok||0, qty:1});
  }
  if($('j_search')) $('j_search').value='';
  if($('j_hasil')) $('j_hasil').innerHTML='';
  renderSales();
}
function bindPenjualan(){
  const si=$('j_search');
  if(si) si.addEventListener('input',()=>{
    const box=$('j_hasil'); if(!box) return;
    const q=si.value.toLowerCase().trim();
    if(!q){ box.innerHTML=''; return; }
    const r=(typeof SPARE!=='undefined'?SPARE:[]).filter(x=>[(x.nama||''),(x.sku||''),(x.merk||''),((x&&x.kategori)||'')].join(' ').toLowerCase().includes(q)).slice(0,8);
    box.innerHTML=r.map(x=>`<button type="button" class="pick" data-sp="${esc(String(x.id))}"><b>${esc(x.nama)}</b> <small>${esc(x.sku)} • ${esc(((x&&x.kategori)||'Lainnya'))} • ${fmtRp(x.harga_jual)} • stok ${esc(x.stok)}</small></button>`).join('')||'<small class="muted">Tidak ada barang cocok.</small>';
    box.querySelectorAll('.pick').forEach(b=>b.onclick=()=>{
      const sp=(typeof findSpare==='function')?findSpare(b.dataset.sp):(SPARE||[]).find(d=>String(d.id)===String(b.dataset.sp));
      if(sp) jualAddBarang(sp);
    });
  });
  if($('j_bayar')) $('j_bayar').addEventListener('input',updKembalian);
  if($('jl_search')) $('jl_search').addEventListener('input',renderSales);
  if($('btnBatalJual')) $('btnBatalJual').onclick=()=>{ CART=[]; if($('j_bayar'))$('j_bayar').value=0; if($('j_catatan'))$('j_catatan').value=''; renderSales(); toast('Keranjang dibatalkan'); };
  if($('btnSimpanJual')) $('btnSimpanJual').onclick=simpanJual;
}
async function simpanJual(){
  if(!CART.length){ toast('Keranjang masih kosong'); return; }
  if(!requireSesi()) return;
  const payload={
    tanggal: val('j_tanggal') || new Date().toISOString().slice(0,10),
    pelanggan: val('j_nama').trim() || 'Umum',
    telp: val('j_telp').trim(),
    metode: val('j_metode','Tunai'),
    catatan: val('j_catatan').trim(),
    items: CART.map(c=>({sparepart_id:Number(c.id), sku:c.sku, qty:Number(c.qty)})),
  };
  const bayar=Number(($('j_bayar')||{}).value||0);
  if(bayar<cartTotal()){
    const kurang=cartTotal()-bayar;
    if(!confirm('Uang diterima KURANG dari total.\nTotal: '+fmtRp(cartTotal())+'\nDiterima: '+fmtRp(bayar)+'\nKurang: '+fmtRp(kurang)+'\n\nTetap simpan?')) return;
  }
  if(useBackend()){
    try{
      const s=await window.API.createSale(payload);
      await pullSpareparts(); await pullSales(); renderAll();
      CART=[]; if($('j_bayar'))$('j_bayar').value=0; if($('j_nama'))$('j_nama').value=''; if($('j_telp'))$('j_telp').value=''; if($('j_catatan'))$('j_catatan').value='';
      renderSales(); toast('Penjualan '+s.no_nota+' tersimpan ✅');
      cetakJual(s.id);
      return;
    }catch(err){ if(handleSesiError(err.message)) return; toast(err.message); return; }
  }
  // offline: validasi + potong stok lokal
  for(const c of CART){
    const sp=(typeof findSpare==='function')?findSpare(c.id):(SPARE||[]).find(d=>String(d.id)===String(c.id));
    if(!sp){ toast('Barang '+c.nama+' tidak ada di stok'); return; }
    if(Number(sp.stok||0)<Number(c.qty||0)){ toast('Stok '+sp.nama+' kurang (sisa '+sp.stok+')'); return; }
  }
  let total=0, hppT=0;
  const items=CART.map(c=>{
    const sp=findSpare(c.id);
    sp.stok=Number(sp.stok||0)-Number(c.qty||0);
    total+=Number(sp.harga_jual||0)*Number(c.qty||0);
    hppT+=Number(sp.hpp||0)*Number(c.qty||0);
    return {sparepart_id:sp.id, sku:sp.sku, nama:sp.nama, hpp:sp.hpp||0, harga:sp.harga_jual||0, qty:Number(c.qty||0), subtotal:Number(sp.harga_jual||0)*Number(c.qty||0)};
  });
  const me=currentUser();
  const s={id:Date.now(), no_nota:genNoNota(), tanggal:payload.tanggal, pelanggan:payload.pelanggan, telp:payload.telp, total, hpp_total:hppT, laba:total-hppT, metode:payload.metode, catatan:payload.catatan, kasir:me?me.nama:'', items};
  SALES.unshift(s); saveSalesLocal();
  try{ if(typeof saveSpareLocal==='function') saveSpareLocal(); }catch{}
  CART=[]; if($('j_bayar'))$('j_bayar').value=0; if($('j_nama'))$('j_nama').value=''; if($('j_telp'))$('j_telp').value=''; if($('j_catatan'))$('j_catatan').value='';
  renderAll(); toast('Penjualan '+s.no_nota+' tersimpan ✅');
  cetakJual(s.id);
}
function notaJualHTML(x){
  const rows=(x.items||[]).map(i=>`${esc(i.nama)} (${esc(i.sku)})<br>&nbsp;&nbsp;${esc(i.qty)} × ${fmtRp(i.harga)} = <b>${fmtRp(i.subtotal)}</b>`).join('<br>');
  return `<div class="nota">
    <h2>${esc(SET.nama)}</h2>
    <p style="text-align:center">${esc(SET.alamat)}<br>Telp: ${esc(SET.telp)}</p>
    <hr>
    <p><b>NOTA PENJUALAN: ${esc(x.no_nota)}</b><br>Tanggal: ${fmtTgl(x.tanggal)} • Kasir: ${esc(x.kasir||'-')}</p>
    <hr>
    <p><b>Pembeli:</b> ${esc(x.pelanggan||'Umum')}${x.telp?' ('+esc(x.telp)+')':''}<br><b>Bayar:</b> ${esc(x.metode||'Tunai')}</p>
    <hr>
    <p>${rows||'-'}</p>
    <hr>
    <p><b>Total: ${fmtRp(x.total)}</b>${x.catatan?'<br>Catatan: '+esc(x.catatan):''}<br><small>${esc(SET.nota)}</small></p>
    <br><br>
    <table style="width:100%;text-align:center"><tr><td>Pembeli<br><br><br>( ............ )</td><td>Kasir<br><br><br>( ${esc(x.kasir||'........')} )</td></tr></table>
  </div>`;
}
window.cetakJual=function(id){
  const x=SALES.find(d=>d.id===id); if(!x) return;
  try{ if(typeof tryPrintJualBT==='function' && tryPrintJualBT(x)) return; }catch(e){ console.warn('BT print gagal:', e); }
  $('printArea').innerHTML=notaJualHTML(x);
  window.print();
};
window.detailJual=function(id){
  const x=SALES.find(d=>d.id===id); if(!x) return;
  $('detailTitle').textContent='Penjualan '+x.no_nota;
  $('detailBody').innerHTML=`
    <div class="kv"><b>Tanggal</b><span>${fmtTgl(x.tanggal)} • ${esc(x.metode||'Tunai')}</span></div>
    <div class="kv"><b>Pembeli</b><span>${esc(x.pelanggan||'Umum')}${x.telp?' • '+esc(x.telp):''}</span></div>
    <div class="kv"><b>Kasir</b><span>${esc(x.kasir||'-')}</span></div>
    <div class="kv"><b>Item</b><span>${(x.items||[]).map(i=>esc(i.nama)+' ×'+esc(i.qty)+' = '+fmtRp(i.subtotal)).join('<br>')||'-'}</span></div>
    <div class="kv"><b>Total</b><span><b>${fmtRp(x.total)}</b> (laba ${fmtRp(x.laba)})</span></div>
    <div class="kv"><b>Catatan</b><span>${esc(x.catatan||'-')}</span></div>`;
  $('detailFoot').innerHTML=`<button class="btn ghost" onclick="cetakJual(${jsStr(x.id)})">🖨 Cetak Nota</button>${isAdminUp()?`<button class="btn ghost" onclick="hapusJual(${jsStr(x.id)})">🗑 Hapus</button>`:''}<button class="btn primary" data-close>Tutup</button>`;
  $('modalDetail').classList.remove('hidden');
};
window.hapusJual=async function(id){
  const x=SALES.find(d=>d.id===id); if(!x) return;
  if(!needAdmin()) return;
  if(!confirm('Hapus nota '+x.no_nota+'? Stok akan dikembalikan.')) return;
  if(useBackend()){
    try{ await window.API.deleteSale(id); await pullSales(); await pullSpareparts(); renderAll(); $('modalDetail').classList.add('hidden'); toast('Nota dihapus, stok dikembalikan'); return; }
    catch(err){ toast(err.message); return; }
  }
  (x.items||[]).forEach(i=>{
    const sp=(typeof findSpare==='function')?findSpare(i.sparepart_id):null;
    if(sp) sp.stok=Number(sp.stok||0)+Number(i.qty||0);
  });
  SALES=SALES.filter(d=>d.id!==id); saveSalesLocal();
  try{ if(typeof saveSpareLocal==='function') saveSpareLocal(); }catch{}
  $('modalDetail').classList.add('hidden');
  renderAll(); toast('Nota dihapus, stok dikembalikan');
};

// ===== PENGELUARAN / BIAYA (mengurangi laba bersih) =====
const LS_EXPENSE = 'servishp_expenses_v1';
let EXPENSES = loadExpensesLocal();
let exEditId = null;
function loadExpensesLocal(){ try{ return JSON.parse(localStorage.getItem(LS_EXPENSE)) || []; }catch{ return []; } }
function saveExpensesLocal(){ try{ localStorage.setItem(LS_EXPENSE, JSON.stringify(EXPENSES)); }catch{} }
async function pullExpenses(){
  if(!useBackend() || !window.API.listExpenses) return false;
  try{
    const list = await window.API.listExpenses({limit:1000});
    EXPENSES = Array.isArray(list) ? list : [];
    saveExpensesLocal(); renderExpenses();
    return true;
  }catch(e){ console.warn('pullExpenses gagal:', e.message); return false; }
}
function exFiltered(){
  const dari=(($('ex_dari')||{}).value||'').slice(0,10);
  const sampai=(($('ex_sampai')||{}).value||'').slice(0,10);
  const q=(($('ex_search')||{}).value||'').toLowerCase().trim();
  let r=[...EXPENSES].sort((a,b)=>(b.id||0)-(a.id||0));
  if(dari||sampai) r=r.filter(x=>inPeriode(x.tanggal||'',dari,sampai));
  if(q) r=r.filter(x=>[(x.kategori||''),(x.keterangan||''),(x.dicatat_oleh||''),(x.tanggal||'')].join(' ').toLowerCase().includes(q));
  return {list:r, dari, sampai};
}
function renderExpenses(){
  if(!$('ex_table')) return;
  if($('ex_tanggal') && !$('ex_tanggal').value) $('ex_tanggal').value=new Date().toISOString().slice(0,10);
  const today=new Date().toISOString().slice(0,10);
  const bm=today.slice(0,7);
  const total=EXPENSES.reduce((a,b)=>a+Number(b.jumlah||0),0);
  const bulan=EXPENSES.filter(x=>String(x.tanggal||'').slice(0,7)===bm).reduce((a,b)=>a+Number(b.jumlah||0),0);
  const hari=EXPENSES.filter(x=>String(x.tanggal||'').slice(0,10)===today).reduce((a,b)=>a+Number(b.jumlah||0),0);
  if($('exTotal')) $('exTotal').textContent=fmtRp(total);
  if($('exBulan')) $('exBulan').textContent=fmtRp(bulan);
  if($('exHari')) $('exHari').textContent=fmtRp(hari);
  if($('exCount')) $('exCount').textContent=EXPENSES.length+' transaksi';
  const {list:r, dari, sampai}=exFiltered();
  const sumR=r.reduce((a,b)=>a+Number(b.jumlah||0),0);
  if($('exInfo')) $('exInfo').textContent = (dari||sampai||(($('ex_search')||{}).value||''))
    ? `Menampilkan ${r.length} dari ${EXPENSES.length} • total tampil ${fmtRp(sumR)}`
    : (EXPENSES.length?`Menampilkan semua (${EXPENSES.length}) • total ${fmtRp(total)}`:'');
  if($('ex_empty')) $('ex_empty').classList.toggle('hidden', r.length>0);
  const admin=isAdminUp();
  if($('ex_table')) $('ex_table').innerHTML=r.slice(0,200).map(x=>`<tr>
    <td><b>${fmtTgl(x.tanggal)}</b><br><small class="muted">${esc(x.kategori||'Lainnya')}</small></td>
    <td>${esc(x.keterangan||'-')}<br><small class="muted">👤 ${esc(x.dicatat_oleh||'-')}</small></td>
    <td style="text-align:right"><b>−${fmtRp(x.jumlah)}</b></td>
    <td><div class="act-btns">${admin?`<button class="icon-btn" onclick="exEdit(${jsStr(x.id)})" title="Edit">✏️</button><button class="icon-btn" onclick="exHapus(${jsStr(x.id)})" title="Hapus">🗑</button>`:'<small class="muted">—</small>'}</div></td></tr>`).join('');
}
async function simpanExpense(){
  if(!requireSesi()) return;
  const tanggal=(val('ex_tanggal')||new Date().toISOString().slice(0,10)).slice(0,10);
  const kategori=val('ex_kategori','Lainnya')||'Lainnya';
  const keterangan=val('ex_ket').trim();
  const jumlah=Number(($('ex_jumlah')||{}).value||0);
  if(!keterangan){ toast('Keterangan wajib diisi'); return; }
  if(!(jumlah>0)){ toast('Jumlah harus lebih dari 0'); return; }
  if(useBackend() && window.API.createExpense){
    try{
      await window.API.createExpense({tanggal, kategori, keterangan, jumlah});
      await pullExpenses(); renderAll();
      if($('ex_ket'))$('ex_ket').value=''; if($('ex_jumlah'))$('ex_jumlah').value=0;
      renderExpenses(); toast('Pengeluaran tersimpan, laba berkurang 💸');
      return;
    }catch(err){ if(handleSesiError(err.message)) return; toast(err.message); return; }
  }
  const me=currentUser();
  EXPENSES.unshift({id:Date.now(), tanggal, kategori, keterangan, jumlah, dicatat_oleh:me?me.nama:''});
  saveExpensesLocal();
  if($('ex_ket'))$('ex_ket').value=''; if($('ex_jumlah'))$('ex_jumlah').value=0;
  renderAll(); toast('Pengeluaran tersimpan, laba berkurang 💸');
}
window.exEdit=function(id){
  if(!needAdmin()) return;
  const x=EXPENSES.find(d=>d.id===id); if(!x){ toast('Data tidak ditemukan'); return; }
  exEditId=x.id;
  if($('mex_tanggal'))$('mex_tanggal').value=(x.tanggal||'').slice(0,10);
  if($('mex_kategori'))$('mex_kategori').value=x.kategori||'Lainnya';
  if($('mex_ket'))$('mex_ket').value=x.keterangan||'';
  if($('mex_jumlah'))$('mex_jumlah').value=x.jumlah||0;
  $('modalExpense').classList.remove('hidden');
};
window.exHapus=async function(id){
  const x=EXPENSES.find(d=>d.id===id); if(!x) return;
  if(!needAdmin()) return;
  if(!confirm('Hapus pengeluaran "'+(x.keterangan||'-')+'" '+fmtRp(x.jumlah)+'? Laba akan bertambah kembali.')) return;
  if(useBackend() && window.API.deleteExpense){
    try{ await window.API.deleteExpense(id); await pullExpenses(); renderAll(); toast('Pengeluaran dihapus'); return; }
    catch(err){ toast(err.message); return; }
  }
  EXPENSES=EXPENSES.filter(d=>d.id!==id); saveExpensesLocal();
  renderAll(); toast('Pengeluaran dihapus');
};
function bindExpenses(){
  if($('btnSimpanEx')) $('btnSimpanEx').onclick=simpanExpense;
  if($('btnBatalEx')) $('btnBatalEx').onclick=()=>{ if($('ex_ket'))$('ex_ket').value=''; if($('ex_jumlah'))$('ex_jumlah').value=0; if($('ex_tanggal'))$('ex_tanggal').value=new Date().toISOString().slice(0,10); toast('Input dibatalkan'); };
  if($('ex_search')) $('ex_search').addEventListener('input',renderExpenses);
  if($('ex_dari')) $('ex_dari').onchange=renderExpenses;
  if($('ex_sampai')) $('ex_sampai').onchange=renderExpenses;
  if($('btnLihatLaporan')) $('btnLihatLaporan').onclick=()=>goto('laporan');
  if($('btnSaveExEdit')) $('btnSaveExEdit').onclick=async ()=>{
    const x=EXPENSES.find(d=>d.id===exEditId); if(!x){ toast('Data tidak ditemukan'); return; }
    const tanggal=(($('mex_tanggal')||{}).value||x.tanggal).slice(0,10);
    const kategori=(($('mex_kategori')||{}).value||x.kategori||'Lainnya');
    const keterangan=(($('mex_ket')||{}).value||'').trim();
    const jumlah=Number(($('mex_jumlah')||{}).value||0);
    if(!keterangan){ toast('Keterangan wajib diisi'); return; }
    if(!(jumlah>0)){ toast('Jumlah harus lebih dari 0'); return; }
    if(useBackend() && window.API.updateExpense){
      try{ await window.API.updateExpense(x.id,{tanggal,kategori,keterangan,jumlah}); await pullExpenses(); renderAll(); $('modalExpense').classList.add('hidden'); toast('Pengeluaran diperbarui ✅'); return; }
      catch(err){ toast(err.message); return; }
    }
    Object.assign(x,{tanggal,kategori,keterangan,jumlah});
    saveExpensesLocal();
    $('modalExpense').classList.add('hidden');
    renderAll(); toast('Pengeluaran diperbarui ✅');
  };
}
try{ bindExpenses(); }catch{}

// ===== LAPORAN (stok + service masuk + penjualan + laba rugi) =====
function lpRange(){
  let dari=val('lp_dari'), sampai=val('lp_sampai');
  return {dari:(dari||'').slice(0,10), sampai:(sampai||'').slice(0,10), kasir:($('lp_kasir')?($('lp_kasir').value||''):'').trim()};
}
// Filter jenis stok di Laporan > Stok Produk (Sparepart/Accessories/Handphone).
// Disimpan di localStorage supaya pilihan user tetap sama setelah reload.
const LS_LP_JENIS='servishp_lp_jenis_v1';
function lpJenis(){
  try{ return String(localStorage.getItem(LS_LP_JENIS)||'').trim(); }catch{ return ''; }
}
function lpSetJenis(v){
  try{ localStorage.setItem(LS_LP_JENIS, String(v||'')); }catch{}
  const el=$('lp_jenis'); if(el) el.value=String(v||'');
}
// ===== FILTER PER KASIR =====
const normKasir = (s)=>String(s||'').trim().split(/\s+/).join(' ').toLowerCase();
function matchKasir(nama, kasir){
  if(!kasir) return true;
  return normKasir(nama)===normKasir(kasir);
}
// daftar kasir unik yang punya transaksi (service / penjualan / pengeluaran)
function kasirList(){
  const set=new Map();
  const add=(n)=>{ const k=normKasir(n); if(k) set.set(k, String(n).trim()); };
  (typeof DB!=='undefined'?DB:[]).forEach(x=>add(x.kasir));
  (typeof SALES!=='undefined'?SALES:[]).forEach(x=>add(x.kasir));
  (typeof EXPENSES!=='undefined'?EXPENSES:[]).forEach(x=>add(x.dicatat_oleh));
  loadUsers().forEach(u=>{ if(u && (u.role||'kasir')!=='superadmin') add(u.nama); });
  return [...set.values()].sort((a,b)=>a.localeCompare(b));
}
function inPeriode(tgl, dari, sampai){
  const t=String(tgl||'').slice(0,10);
  if(dari && t<dari) return false;
  if(sampai && t>sampai) return false;
  return true;
}
function computeReportLocal(dari, sampai, kasir){
  kasir=String(kasir||'').trim();
  const svc=(typeof DB!=='undefined'?DB:[]).filter(x=>inPeriode(x.tanggal||'',dari,sampai)&&matchKasir(x.kasir,kasir));
  const jual=SALES.filter(x=>inPeriode(x.tanggal||'',dari,sampai)&&matchKasir(x.kasir,kasir));
  const sp=(typeof SPARE!=='undefined'?SPARE:[]);
  // Omzet service HANYA dari status Diambil
  const diambil=svc.filter(x=>normStatus(x.status)==='Diambil');
  const per={}; STATUS.forEach(s=>per[s]=svc.filter(x=>normStatus(x.status)===s).length);
  const sOm=diambil.reduce((a,b)=>a+Number(b.biaya||0),0);
  const jOm=jual.reduce((a,b)=>a+Number(b.total||0),0);
  const jHpp=jual.reduce((a,b)=>a+Number(b.hpp_total||0),0);
  const jLb=jOm-jHpp;
  const exList=(typeof EXPENSES!=='undefined'?EXPENSES:[]).filter(x=>inPeriode(x.tanggal||'',dari,sampai)&&matchKasir(x.dicatat_oleh,kasir));
  const exTot=exList.reduce((a,b)=>a+Number(b.jumlah||0),0);
  return {
    dari: dari||'', sampai: sampai||'', kasir: kasir,
    service_masuk: svc.length,
    service_selesai: diambil.length,
    service_omzet: sOm, service_per_status: per,
    service_diambil: [...diambil].sort((a,b)=>(b.id||0)-(a.id||0)).slice(0,50).map(x=>({noService:x.noService,tanggal:x.tanggal,nama:x.nama,telp:x.telp,merk:x.merk,tipe:x.tipe,biaya:x.biaya,teknisi:x.teknisi,kasir:x.kasir})),
    penjualan_count: jual.length, penjualan_omzet: jOm, penjualan_hpp: jHpp, penjualan_laba: jLb,
    expense_count: exList.length, expense_total: exTot,
    total_pendapatan: sOm+jOm, total_laba: sOm+jLb-exTot,
    stok_item: sp.length,
    stok_nilai_hpp: sp.reduce((a,b)=>a+Number(b.hpp||0)*Number(b.stok||0),0),
    stok_nilai_jual: sp.reduce((a,b)=>a+Number(b.harga_jual||0)*Number(b.stok||0),0),
    stok_menipis: sp.filter(x=>Number(x.stok||0)<=Number(x.stok_min||0)).length,
    _jualList: [...jual].sort((a,b)=>(b.id||0)-(a.id||0)).slice(0,50),
  };
}
let LAPORAN_CACHE=null;
async function renderLaporan(){
  if(!$('lpLabaBody')) return;
  const {dari, sampai, kasir}=lpRange();
  let r=null;
  if(useBackend()){
    try{ r=await window.API.report(dari, sampai, kasir); }catch{ r=null; }
  }
  if(!r){
    r=computeReportLocal(dari, sampai, kasir);
  }
  if(!(r._jualList||[]).length){
    try{
      if(useBackend()){ const ls=await window.API.listSales({dari, sampai, kasir, limit:50}); if(ls&&ls.length) r._jualList=ls; }
    }catch{}
  }
  // Backend mungkin belum punya kolom expense (server lama) -> hitung dari lokal agar tetap konsisten
  try{
    if((r.expense_total===undefined||r.expense_count===undefined) && (typeof EXPENSES!=='undefined')){
      const exL=EXPENSES.filter(x=>inPeriode(x.tanggal||'',dari,sampai)&&matchKasir(x.dicatat_oleh,kasir));
      r.expense_count=exL.length;
      r.expense_total=exL.reduce((a,b)=>a+Number(b.jumlah||0),0);
      r.total_laba=Number(r.service_omzet||0)+Number(r.penjualan_laba||0)-Number(r.expense_total||0);
    }
  }catch{}
  LAPORAN_CACHE=r;
  const periode=(r.dari||r.sampai)?`Periode: ${r.dari||'…'} s/d ${r.sampai||'…'}`:'Semua periode';
  const kasirTag=(r.kasir||kasir)?` • Kasir: ${r.kasir||kasir}`:'';
  if($('lpInfo')) $('lpInfo').textContent=periode+kasirTag+` • ${r.service_masuk} service • ${r.penjualan_count} nota • ${r.expense_count||0} biaya`;
  if($('lpPeriode')) $('lpPeriode').textContent=periode+(r.kasir||kasir?(' • '+r.kasir):'');
  if($('lpPendapatan')) $('lpPendapatan').textContent=fmtRp(r.total_pendapatan);
  if($('lpLaba')) $('lpLaba').textContent=fmtRp(r.total_laba);
  if($('lpService')) $('lpService').textContent=fmtRp(r.service_omzet);
  if($('lpJual')) $('lpJual').textContent=fmtRp(r.penjualan_omzet);
  if($('lpExpense')) $('lpExpense').textContent=fmtRp(r.expense_total||0);
  if($('lpExpenseCount')) $('lpExpenseCount').textContent=(r.expense_count||0);
  if($('lpSvcMasuk')) $('lpSvcMasuk').textContent=r.service_masuk;
  if($('lpSvcSelesai')) $('lpSvcSelesai').textContent=r.service_selesai;
  if($('lpSvcOmzet')) $('lpSvcOmzet').textContent=fmtRp(r.service_omzet);
  if($('lpJlNota')) $('lpJlNota').textContent=r.penjualan_count;
  if($('lpJlOmzet')) $('lpJlOmzet').textContent=fmtRp(r.penjualan_omzet);
  if($('lpJlLaba')) $('lpJlLaba').textContent=fmtRp(r.penjualan_laba);
  // Catatan: kartu statistik stok (lpStItem/lpStHpp/lpStJual/lpStLow)
  // dihitung ulang di bawah dari data SPARE + filter jenis, supaya kartu
  // selalu sama dengan isi tabel.
  if($('lpLabaBody')) $('lpLabaBody').innerHTML=`
    <tr><td>Pendapatan service (${esc(r.service_selesai)} Diambil, hanya Diambil masuk omzet)</td><td style="text-align:right"><b>${fmtRp(r.service_omzet)}</b></td></tr>
    <tr><td>Pendapatan penjualan barang (${esc(r.penjualan_count)} nota)</td><td style="text-align:right"><b>${fmtRp(r.penjualan_omzet)}</b></td></tr>
    <tr><td><b>Total pendapatan</b></td><td style="text-align:right"><b>${fmtRp(r.total_pendapatan)}</b></td></tr>
    <tr><td>HPP barang terjual</td><td style="text-align:right">(${fmtRp(r.penjualan_hpp)})</td></tr>
    <tr><td>Laba penjualan (jual − HPP)</td><td style="text-align:right"><b>${fmtRp(r.penjualan_laba)}</b></td></tr>
    <tr><td>Pengeluaran / biaya (${esc(r.expense_count||0)} transaksi) — <a href="#" onclick="goto('pengeluaran');return false;" style="color:var(--blue)">lihat rincian →</a></td><td style="text-align:right">(${fmtRp(r.expense_total||0)})</td></tr>
    <tr><td><b>Laba bersih (service + laba jual − pengeluaran)</b></td><td style="text-align:right"><b>${fmtRp(r.total_laba)}</b></td></tr>`;
  const per=r.service_per_status||{};
  if($('lpServiceCount')) $('lpServiceCount').textContent=r.service_masuk;
  if($('lpServiceBody')) $('lpServiceBody').innerHTML=STATUS.map(s=>`<tr><td>${badge(s)}</td><td style="text-align:right"><b>${esc(per[s]||0)}</b></td></tr>`).join('')
    + `<tr><td><b>Diambil (masuk omzet)</b></td><td style="text-align:right"><b>${esc(r.service_selesai)}</b></td></tr>
       <tr><td><b>Omzet service (hanya Diambil)</b></td><td style="text-align:right"><b>${fmtRp(r.service_omzet)}</b></td></tr>`;
  // Tabel rincian service yang SUDAH DIAMBIL (sumber omzet service)
  let diambilList=r.service_diambil||[];
  if(!diambilList.length){
    try{
      const {dari:dd, sampai:ss, kasir:kk}=lpRange();
      diambilList=(typeof DB!=='undefined'?DB:[]).filter(x=>normStatus(x.status)==='Diambil'&&inPeriode(x.tanggal||'',dd,ss)&&matchKasir(x.kasir,kk))
        .sort((a,b)=>(b.id||0)-(a.id||0)).slice(0,50)
        .map(x=>({noService:x.noService,tanggal:x.tanggal,nama:x.nama,telp:x.telp,merk:x.merk,tipe:x.tipe,biaya:x.biaya,teknisi:x.teknisi,kasir:x.kasir}));
    }catch{}
  }
  if($('lpDiambilCount')) $('lpDiambilCount').textContent=diambilList.length;
  if($('lpDiambilBody')) $('lpDiambilBody').innerHTML=diambilList.map(x=>`<tr><td><b>${esc(x.noService||'-')}</b><br><small class="muted">${fmtTgl(x.tanggal)}</small></td><td>${esc(x.nama||'-')}<br><small class="muted">${esc(x.merk||'')} ${esc(x.tipe||'')}</small></td><td>${esc(x.kasir||'-')}</td><td style="text-align:right"><b>${fmtRp(x.biaya)}</b></td></tr>`).join('')||'<tr><td colspan="4">Belum ada service Diambil pada periode ini.</td></tr>';
  const jl=r._jualList||[];
  if($('lpJualCount')) $('lpJualCount').textContent=r.penjualan_count;
  if($('lpJualBody')) $('lpJualBody').innerHTML=jl.map(x=>`<tr><td><b>${esc(x.no_nota||x.noService||'-')}</b><br><small class="muted">${fmtTgl(x.tanggal)}</small></td><td>${esc(x.pelanggan||x.nama||'Umum')}</td><td>${esc(x.kasir||'-')}</td><td style="text-align:right"><b>${fmtRp(x.total||x.biaya||0)}</b></td></tr>`).join('')||'<tr><td colspan="4">Belum ada penjualan pada periode ini.</td></tr>';
  const sp=renderStokLaporan();
  renderRekapKasir(dari, sampai);
  renderRekapHarian(dari, sampai, kasir);
}
// Tabel + kartu statistik Laporan > Stok Produk, dengan filter jenis.
// Filter: '' (semua) | 'Sparepart' | 'Accessories' | 'Handphone'
function renderStokLaporan(){
  const spAll=[...(typeof SPARE!=='undefined'?SPARE:[])].sort((a,b)=>String(a.nama||'').localeCompare(String(b.nama||'')));
  const jenisF=lpJenis();
  const sp=jenisF ? spAll.filter(x=>spJenis(x)===jenisF) : spAll;
  const stokHpp=sp.reduce((a,b)=>a+Number(b.hpp||0)*Number(b.stok||0),0);
  const stokJual=sp.reduce((a,b)=>a+Number(b.harga_jual||0)*Number(b.stok||0),0);
  const stokLow=sp.filter(x=>Number(x.stok||0)<=Number(x.stok_min||0)).length;
  // Kartu statistik ikut filter supaya cocok dengan isi tabel.
  if($('lpStItem')) $('lpStItem').textContent=sp.length;
  if($('lpStHpp')) $('lpStHpp').textContent=fmtRp(stokHpp);
  if($('lpStJual')) $('lpStJual').textContent=fmtRp(stokJual);
  if($('lpStLow')) $('lpStLow').textContent=stokLow;
  if($('lpStokCount')) $('lpStokCount').textContent=sp.length;
  if($('lpStokBody')) $('lpStokBody').innerHTML=sp.map(x=>{ const low=Number(x.stok||0)<=Number(x.stok_min||0); return `<tr>
    <td><b>${esc(x.sku)}</b></td><td><b>${esc(x.nama)}</b><br><small class="muted">${esc(x.merk||'')} • ${esc(((x&&x.kategori)||'Lainnya'))}</small></td>
    <td><span class="badge b-Dikerjakan">${esc(spJenis(x))}</span></td>
    <td>${fmtRp(x.hpp)}</td><td><b>${fmtRp(x.harga_jual)}</b></td>
    <td><b>${esc(x.stok)}</b><br>${low?'<span class="badge b-Batal">Menipis</span>':'<span class="badge b-Selesai">Aman</span>'}</td>
    <td style="text-align:right"><b>${fmtRp(Number(x.hpp||0)*Number(x.stok||0))}</b></td></tr>`; }).join('')
    + `<tr><td colspan="6"><b>Total nilai stok (HPP)${jenisF?(' • '+esc(jenisF)):''}</b> • ${esc(stokLow)} menipis</td><td style="text-align:right"><b>${fmtRp(stokHpp)}</b></td></tr>`;
  return sp;
}
// Rekap gabungan per kasir (dihitung dari data lokal yg sudah sync dari backend)
function renderRekapKasir(dari, sampai){
  if(!$('lpKasirBody')) return;
  const rows=new Map();
  const get=(n)=>{
    const k=normKasir(n); if(!k) return null;
    if(!rows.has(k)) rows.set(k,{nama:String(n).trim(),svc:0,svcOm:0,nota:0,jual:0,labaJual:0,exp:0,expN:0});
    return rows.get(k);
  };
  (typeof DB!=='undefined'?DB:[]).forEach(x=>{
    if(!inPeriode(x.tanggal||'',dari,sampai)) return;
    const r=get(x.kasir); if(!r) return;
    if(normStatus(x.status)==='Diambil'){ r.svc++; r.svcOm+=Number(x.biaya||0); }
  });
  (typeof SALES!=='undefined'?SALES:[]).forEach(x=>{
    if(!inPeriode(x.tanggal||'',dari,sampai)) return;
    const r=get(x.kasir); if(!r) return;
    r.nota++; r.jual+=Number(x.total||0); r.labaJual+=Number(x.laba!=null?x.laba:(Number(x.total||0)-Number(x.hpp_total||0)));
  });
  (typeof EXPENSES!=='undefined'?EXPENSES:[]).forEach(x=>{
    if(!inPeriode(x.tanggal||'',dari,sampai)) return;
    const r=get(x.dicatat_oleh); if(!r) return;
    r.exp+=Number(x.jumlah||0); r.expN++;
  });
  const list=[...rows.values()].sort((a,b)=>(b.svcOm+b.jual)-(a.svcOm+a.jual));
  const t=list.reduce((o,r)=>({svc:o.svc+r.svc, svcOm:o.svcOm+r.svcOm, nota:o.nota+r.nota, jual:o.jual+r.jual, labaJual:o.labaJual+r.labaJual, exp:o.exp+r.exp}),{svc:0,svcOm:0,nota:0,jual:0,labaJual:0,exp:0});
  const laba=(r)=>r.svcOm+r.labaJual-r.exp;
  if($('lpKasirCount')) $('lpKasirCount').textContent=list.length;
  if($('lpKasirPeriode')) $('lpKasirPeriode').textContent=(dari||sampai)?`${dari||'…'} s/d ${sampai||'…'}`:'Semua periode';
  if($('lpKasirBody')) $('lpKasirBody').innerHTML=list.map(r=>`<tr>
    <td><b>${esc(r.nama)}</b>${r.expN?`<br><small class="muted">${esc(r.expN)} pengeluaran</small>`:''}</td>
    <td style="text-align:right">${esc(r.svc)}</td>
    <td style="text-align:right"><b>${fmtRp(r.svcOm)}</b></td>
    <td style="text-align:right">${esc(r.nota)}</td>
    <td style="text-align:right"><b>${fmtRp(r.jual)}</b></td>
    <td style="text-align:right">${fmtRp(r.labaJual)}</td>
    <td style="text-align:right">(${fmtRp(r.exp)})</td>
    <td style="text-align:right"><b>${fmtRp(laba(r))}</b></td></tr>`).join('')
    + `<tr><td><b>TOTAL</b></td><td style="text-align:right"><b>${esc(t.svc)}</b></td><td style="text-align:right"><b>${fmtRp(t.svcOm)}</b></td><td style="text-align:right"><b>${esc(t.nota)}</b></td><td style="text-align:right"><b>${fmtRp(t.jual)}</b></td><td style="text-align:right"><b>${fmtRp(t.labaJual)}</b></td><td style="text-align:right"><b>(${fmtRp(t.exp)})</b></td><td style="text-align:right"><b>${fmtRp(t.svcOm+t.labaJual-t.exp)}</b></td></tr>`
    || '<tr><td colspan="8">Belum ada transaksi pada periode ini.</td></tr>';
}
// ===== REKAP HARIAN PER KASIR =====
// Satu baris per (tanggal, kasir). Sumber: backend /api/stats/harian.
// Kalau backend tidak ada (mode offline), dihitung dari data lokal.
function computeHarianLocal(dari,sampai,kasir){
  const rows=new Map();
  const get=(tgl,nama)=>{
    const k=tgl+'||'+normKasir(nama);
    if(!rows.has(k)) rows.set(k,{tanggal:tgl,kasir:String(nama||'').trim()||'-',svc_masuk:0,svc_diambil:0,svc_omzet:0,nota:0,jual_omzet:0,jual_laba:0,exp:0,exp_n:0,wa_terkirim:0,total_pendapatan:0,total_laba:0});
    return rows.get(k);
  };
  (typeof DB!=='undefined'?DB:[]).forEach(x=>{
    if(!inPeriode(x.tanggal||'',dari,sampai)) return;
    if(kasir && !matchKasir(x.kasir,kasir)) return;
    const r=get(String(x.tanggal||'').slice(0,10), x.kasir||'-');
    r.svc_masuk++;
    if(normStatus(x.status)==='Diambil'){ r.svc_diambil++; r.svc_omzet+=Number(x.biaya||0); }
    if(x.wa_terkirim_at) r.wa_terkirim++;
  });
  (typeof SALES!=='undefined'?SALES:[]).forEach(x=>{
    if(!inPeriode(x.tanggal||'',dari,sampai)) return;
    if(kasir && !matchKasir(x.kasir,kasir)) return;
    const r=get(String(x.tanggal||'').slice(0,10), x.kasir||'-');
    r.nota++; r.jual_omzet+=Number(x.total||0);
    r.jual_laba+=Number(x.laba!=null?x.laba:(Number(x.total||0)-Number(x.hpp_total||0)));
  });
  (typeof EXPENSES!=='undefined'?EXPENSES:[]).forEach(x=>{
    if(!inPeriode(x.tanggal||'',dari,sampai)) return;
    if(kasir && !matchKasir(x.dicatat_oleh,kasir)) return;
    const r=get(String(x.tanggal||'').slice(0,10), x.dicatat_oleh||'-');
    r.exp+=Number(x.jumlah||0); r.exp_n++;
  });
  const out=[...rows.values()];
  out.forEach(r=>{ r.total_pendapatan=r.svc_omzet+r.jual_omzet; r.total_laba=r.svc_omzet+r.jual_laba-r.exp; });
  out.sort((a,b)=>(b.tanggal+a.kasir).localeCompare(a.tanggal+b.kasir));
  const sum=(k)=>out.reduce((o,r)=>o+Number(r[k]||0),0);
  return {dari:dari||'',sampai:sampai||'',kasir:kasir||'',rows:out,
    ringkasan:{hari:new Set(out.map(r=>r.tanggal)).size, svc_masuk:sum('svc_masuk'), svc_diambil:sum('svc_diambil'),
      svc_omzet:sum('svc_omzet'), nota:sum('nota'), jual_omzet:sum('jual_omzet'), jual_laba:sum('jual_laba'),
      exp:sum('exp'), wa_terkirim:sum('wa_terkirim'), total_pendapatan:sum('total_pendapatan'), total_laba:sum('total_laba')}};
}
let HARIAN_CACHE=null;
async function renderRekapHarian(dari,sampai,kasir){
  if(!$('lpHarianBody')) return;
  let h=null;
  if(useBackend() && window.API.reportHarian){
    try{ h=await window.API.reportHarian(dari,sampai,kasir); }catch(e){ h=null; }
  }
  if(!h) h=computeHarianLocal(dari,sampai,kasir);
  HARIAN_CACHE=h;
  const rows=h.rows||[], rk=h.ringkasan||{};
  if($('lpHarianCount')) $('lpHarianCount').textContent=rows.length;
  if($('lpHarianPeriode')) $('lpHarianPeriode').textContent=(dari||sampai)?`${dari||'…'} s/d ${sampai||'…'}`:'Semua periode';
  if($('lpHariCount')) $('lpHariCount').textContent=rk.hari||0;
  if($('lpHariSvc')) $('lpHariSvc').textContent=rk.svc_diambil||0;
  if($('lpHariOmzet')) $('lpHariOmzet').textContent=fmtRp(rk.svc_omzet||0);
  if($('lpHariWa')) $('lpHariWa').textContent=rk.wa_terkirim||0;
  const body=rows.map(r=>`<tr>
    <td>${fmtTgl(r.tanggal)}</td>
    <td><b>${esc(r.kasir)}</b></td>
    <td style="text-align:right">${esc(r.svc_masuk||0)}</td>
    <td style="text-align:right">${esc(r.svc_diambil||0)}</td>
    <td style="text-align:right"><b>${fmtRp(r.svc_omzet||0)}</b></td>
    <td style="text-align:right">${esc(r.nota||0)}</td>
    <td style="text-align:right">${fmtRp(r.jual_omzet||0)}</td>
    <td style="text-align:right">(${fmtRp(r.exp||0)})</td>
    <td style="text-align:right"><b>${fmtRp(r.total_laba||0)}</b></td>
    <td style="text-align:right">${r.wa_terkirim?'✅ '+esc(r.wa_terkirim):'—'}</td></tr>`).join('');
  $('lpHarianBody').innerHTML=(body
    + `<tr><td><b>TOTAL</b></td><td></td>
        <td style="text-align:right"><b>${esc(rk.svc_masuk||0)}</b></td>
        <td style="text-align:right"><b>${esc(rk.svc_diambil||0)}</b></td>
        <td style="text-align:right"><b>${fmtRp(rk.svc_omzet||0)}</b></td>
        <td style="text-align:right"><b>${esc(rk.nota||0)}</b></td>
        <td style="text-align:right"><b>${fmtRp(rk.jual_omzet||0)}</b></td>
        <td style="text-align:right"><b>(${fmtRp(rk.exp||0)})</b></td>
        <td style="text-align:right"><b>${fmtRp(rk.total_laba||0)}</b></td>
        <td style="text-align:right"><b>${esc(rk.wa_terkirim||0)}</b></td></tr>`)
    || '<tr><td colspan="10">Belum ada transaksi pada periode ini.</td></tr>';
}
function syncLpKasirOptions(){
  const el=$('lp_kasir'); if(!el) return;
  const cur=el.value||'';
  const list=kasirList();
  el.innerHTML='<option value="">Semua kasir</option>'+list.map(n=>`<option value="${esc(n)}" ${normKasir(n)===normKasir(cur)?'selected':''}>${esc(n)}</option>`).join('');
  if(cur && !list.some(n=>normKasir(n)===normKasir(cur))) el.value='';
}
function bindLaporan(){
  document.querySelectorAll('#lpTabs .ltab').forEach(b=>b.onclick=()=>gotoLtab(b.dataset.ltab));
  const setD=(d,s)=>{ if($('lp_dari'))$('lp_dari').value=d; if($('lp_sampai'))$('lp_sampai').value=s; renderLaporan(); };
  const today=new Date().toISOString().slice(0,10);
  // Default laporan = HARI INI (per tanggal), bukan akumulasi semua periode.
  if($('lp_dari') && !$('lp_dari').value) $('lp_dari').value=today;
  if($('lp_sampai') && !$('lp_sampai').value) $('lp_sampai').value=today;
  if($('lpToday')) $('lpToday').onclick=()=>setD(today,today);
  if($('lp7')) $('lp7').onclick=()=>setD(new Date(Date.now()-6*864e5).toISOString().slice(0,10),today);
  if($('lp30')) $('lp30').onclick=()=>setD(new Date(Date.now()-29*864e5).toISOString().slice(0,10),today);
  if($('lpAll')) $('lpAll').onclick=()=>setD('','');
  if($('btnLpTampil')) $('btnLpTampil').onclick=()=>{ syncLpKasirOptions(); renderLaporan(); toast('Laporan diperbarui 📊'); };
  if($('lp_dari')) $('lp_dari').onchange=renderLaporan;
  if($('lp_sampai')) $('lp_sampai').onchange=renderLaporan;
  if($('lp_kasir')) $('lp_kasir').onchange=()=>renderLaporan();
  if($('lpResetKasir')) $('lpResetKasir').onclick=()=>{ if($('lp_kasir'))$('lp_kasir').value=''; renderLaporan(); toast('Filter kasir direset ↺'); };
  // Filter jenis stok (Laporan > Stok Produk)
  if($('lp_jenis')){
    $('lp_jenis').value=lpJenis();
    $('lp_jenis').onchange=()=>{ lpSetJenis($('lp_jenis').value); renderLaporan(); };
  }
  if($('lpResetJenis')) $('lpResetJenis').onclick=()=>{ lpSetJenis(''); renderLaporan(); toast('Filter jenis direset ↺'); };
  if($('btnLpCSV')) $('btnLpCSV').onclick=exportLaporanCSV;
  if($('btnLpPrint')) $('btnLpPrint').onclick=printLaporan;
  syncLpKasirOptions();
  try{ syncLpFilterRows(NAVLTAB.laporan||'laba'); }catch{}
}
// Tab Stok Produk tidak butuh filter kasir -> tampilkan filter jenis di tempatnya.
function syncLpFilterRows(name){
  const isStok=(name==='stok');
  if($('lp_kasirRow')) $('lp_kasirRow').classList.toggle('hidden', isStok);
  if($('lp_jenisRow')) $('lp_jenisRow').classList.toggle('hidden', !isStok);
}
window.gotoLtab=function(name){
  document.querySelectorAll('#lpTabs .ltab').forEach(b=>b.classList.toggle('active', b.dataset.ltab===name));
  document.querySelectorAll('.ltab-pane').forEach(p=>p.classList.toggle('active', p.id==='ltab-'+name));
  curLtab=name;
  NAVLTAB.laporan=name;
  try{ syncLpFilterRows(name); }catch{}
  try{ navSyncActive('laporan', name, 'laporan'); }catch{}
};
function exportLaporanCSV(){
  const r=LAPORAN_CACHE||computeReportLocal(...Object.values(lpRange()));
  const L=[];
  L.push('LAPORAN POS KONTER');
  L.push('Periode,'+(r.dari||'…')+' s/d '+(r.sampai||'…'));
  L.push('Kasir,'+(r.kasir||'Semua kasir'));
  L.push('');
  L.push('LABA RUGI');
  L.push('Keterangan,Nilai');
  L.push('Pendapatan service,'+r.service_omzet);
  L.push('Pendapatan penjualan,'+r.penjualan_omzet);
  L.push('Total pendapatan,'+r.total_pendapatan);
  L.push('HPP barang terjual,'+r.penjualan_hpp);
  L.push('Laba penjualan,'+r.penjualan_laba);
  L.push('Pengeluaran/biaya ('+(r.expense_count||0)+' transaksi),'+(r.expense_total||0));
  L.push('Laba bersih (service + laba jual - pengeluaran),'+r.total_laba);
  L.push('');
  L.push('SERVICE PER STATUS');
  L.push('Status,Jumlah');
  STATUS.forEach(s=>L.push(s+','+((r.service_per_status||{})[s]||0)));
  L.push('');
  L.push('SERVICE SUDAH DIAMBIL (masuk omzet)');
  L.push('NoService,Tanggal,Nama,HP,Biaya');
  (r.service_diambil||[]).forEach(x=>L.push([x.noService,x.tanggal,'"'+String(x.nama||'').replace(/"/g,'""')+'"',x.telp,x.biaya].join(',')));
  L.push('');
  L.push('REKAP PER KASIR');
  L.push('Kasir,Service Diambil,Omzet Service,Nota,Omzet Jual,Laba Jual,Pengeluaran,Laba Bersih');
  try{
    const f=$('lpKasirBody');
    if(f) [...f.querySelectorAll('tr')].forEach(tr=>{
      const c=[...tr.children].map(td=>(td.textContent||'').replace(/\s+/g,' ').trim());
      L.push(c.map((v,i)=>i===0?('"'+v.replace(/"/g,'""')+'"'):v).join(','));
    });
  }catch{}
  L.push('');
  L.push('REKAP HARIAN PER KASIR');
  L.push('Tanggal,Kasir,Svc Masuk,Svc Diambil,Omzet Service,Nota,Omzet Jual,Pengeluaran,Laba Bersih,WA Terkirim');
  try{
    const h=HARIAN_CACHE||computeHarianLocal(...Object.values(lpRange()));
    (h.rows||[]).forEach(x=>L.push([x.tanggal,'"'+String(x.kasir||'').replace(/"/g,'""')+'"',x.svc_masuk||0,x.svc_diambil||0,x.svc_omzet||0,x.nota||0,x.jual_omzet||0,x.exp||0,x.total_laba||0,x.wa_terkirim||0].join(',')));
    const rk=h.ringkasan||{};
    L.push(['TOTAL','',rk.svc_masuk||0,rk.svc_diambil||0,rk.svc_omzet||0,rk.nota||0,rk.jual_omzet||0,rk.exp||0,rk.total_laba||0,rk.wa_terkirim||0].join(','));
  }catch{}
  L.push('');
  L.push('STOK'+(lpJenis()?(' • '+lpJenis()):''));
  L.push('SKU,Nama,Merk,Kategori,Jenis,HPP,Jual,Stok,Nilai HPP');
  {
    const spAll=[...(typeof SPARE!=='undefined'?SPARE:[])].sort((a,b)=>String(a.nama||'').localeCompare(String(b.nama||'')));
    const jf=lpJenis();
    const spF=jf ? spAll.filter(x=>spJenis(x)===jf) : spAll;
    spF.forEach(x=>L.push([x.sku,'"'+String(x.nama||'').replace(/"/g,'""')+'"',x.merk,'"'+String(((x&&x.kategori)||'Lainnya')).replace(/"/g,'""')+'"',spJenis(x),x.hpp,x.harga_jual,x.stok,Number(x.hpp||0)*Number(x.stok||0)].join(',')));
    L.push(['TOTAL','','','','','','',spF.length,spF.reduce((a,b)=>a+Number(b.hpp||0)*Number(b.stok||0),0)].join(','));
  }
  download('laporan-'+(r.dari||'semua')+'-sd-'+(r.sampai||'semua')+'.csv','\uFEFF'+L.join('\n'),'text/csv');
  toast('CSV laporan diunduh ⬇');
}
function printLaporan(){
  const r=LAPORAN_CACHE||computeReportLocal(...Object.values(lpRange()));
  const spAll=[...(typeof SPARE!=='undefined'?SPARE:[])].sort((a,b)=>String(a.nama||'').localeCompare(String(b.nama||'')));
  const jenisF=lpJenis();
  const sp=jenisF ? spAll.filter(x=>spJenis(x)===jenisF) : spAll;
  const stokHpp=sp.reduce((a,b)=>a+Number(b.hpp||0)*Number(b.stok||0),0);
  const stokJual=sp.reduce((a,b)=>a+Number(b.harga_jual||0)*Number(b.stok||0),0);
  const stokLow=sp.filter(x=>Number(x.stok||0)<=Number(x.stok_min||0)).length;
  let harianHtml='';
  try{
    const h=HARIAN_CACHE||computeHarianLocal(...Object.values(lpRange()));
    const rows=(h.rows||[]).slice(0,40);
    harianHtml=`<hr>
    <p><b>Rekap Harian per Kasir</b> (${esc((h.rows||[]).length)} baris)<br>
    ${rows.map(x=>esc(x.tanggal)+' • '+esc(x.kasir)+' — svc '+esc(x.svc_diambil||0)+' • '+fmtRp(x.svc_omzet||0)+' • laba '+fmtRp(x.total_laba||0)+(x.wa_terkirim?(' • WA '+esc(x.wa_terkirim)):'')).join('<br>')||'-'}</p>`;
  }catch{}
  $('printArea').innerHTML=`<div class="nota">
    <h2>${esc(SET.nama)}</h2>
    <p style="text-align:center">${esc(SET.alamat)}<br>Telp: ${esc(SET.telp)}</p>
    <hr>
    <p><b>LAPORAN</b><br>Periode: ${esc(r.dari||'…')} s/d ${esc(r.sampai||'…')}${r.kasir?('<br>Kasir: '+esc(r.kasir)):''}</p>
    <hr>
    <p><b>Laba Rugi</b><br>
    Pendapatan service (hanya Diambil): ${fmtRp(r.service_omzet)} (${esc(r.service_selesai)} unit)<br>
    Pendapatan penjualan: ${fmtRp(r.penjualan_omzet)} (${esc(r.penjualan_count)} nota)<br>
    <b>Total pendapatan: ${fmtRp(r.total_pendapatan)}</b><br>
    HPP terjual: ${fmtRp(r.penjualan_hpp)}<br>
    Pengeluaran: ${fmtRp(r.expense_total||0)} (${esc(r.expense_count||0)} transaksi)<br>
    <b>Laba bersih: ${fmtRp(r.total_laba)}</b></p>
    <hr>
    <p><b>Service per status:</b><br>${STATUS.map(s=>esc(s)+': '+esc((r.service_per_status||{})[s]||0)).join('<br>')}</p>
    ${harianHtml}
    <hr>
    <p><b>Stok${jenisF?(' — '+esc(jenisF)):''}:</b> ${esc(sp.length)} item • Nilai HPP ${fmtRp(stokHpp)} • Nilai Jual ${fmtRp(stokJual)} • ${esc(stokLow)} menipis<br>
    ${sp.slice(0,60).map(x=>esc(x.sku)+' '+esc(x.nama)+' — stok '+esc(x.stok)).join('<br>')}${sp.length>60?'<br>... +'+(sp.length-60)+' item lain':''}</p>
  </div>`;
  window.print();
}
try{ bindPenjualan(); }catch{}
try{ bindLaporan(); }catch{}
try{
  if($('btnOmPrev')) $('btnOmPrev').onclick=()=>omzetGeser(-1);
  if($('btnOmNext')) $('btnOmNext').onclick=()=>omzetGeser(1);
  if($('btnOmNow')) $('btnOmNow').onclick=()=>{ omzetY=null; omzetM=null; renderOmzetChart(); };
  let omzetRsz;
  window.addEventListener('resize', ()=>{ clearTimeout(omzetRsz); omzetRsz=setTimeout(renderOmzetChart,150); });
}catch{}

// ===== GRAFIK PERFORMA PENJUALAN BULANAN (area halus, SVG murni) =====
let omzetY = null, omzetM = null; // null = bulan berjalan
const NAMA_BULAN = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
function omzetCursor(){
  const now=new Date();
  return { y:(omzetY===null?now.getFullYear():omzetY), m:(omzetM===null?now.getMonth():omzetM) };
}
function bulanLabel(y,m){ return NAMA_BULAN[m]+' '+y; }
function omzetBulan(){
  const {y, m}=omzetCursor();
  const nDay=new Date(y, m+1, 0).getDate();
  const svcArr=(typeof DB!=='undefined'?DB:[]);
  const jualArr=(typeof SALES!=='undefined'?SALES:[]);
  const out=[];
  for(let d=1;d<=nDay;d++){
    const t=y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    const svc=svcArr.filter(x=>(x.tanggal||'').slice(0,10)===t && normStatus(x.status)==='Diambil').reduce((a,b)=>a+Number(b.biaya||0),0);
    const jual=jualArr.filter(x=>(x.tanggal||'').slice(0,10)===t).reduce((a,b)=>a+Number(b.total||0),0);
    out.push({d, t, svc, jual, total:svc+jual});
  }
  return out;
}
function niceMax(v){
  if(!(v>0)) return 1;
  const p=Math.pow(10, Math.floor(Math.log10(v)));
  const n=v/p;
  return (n<=1?1:n<=2?2:n<=2.5?2.5:n<=5?5:10)*p;
}
function smoothPath(pts){
  if(!pts.length) return '';
  if(pts.length===1) return `M ${pts[0].x},${pts[0].y}`;
  let d=`M ${pts[0].x},${pts[0].y}`;
  for(let i=0;i<pts.length-1;i++){
    const p0=pts[Math.max(i-1,0)], p1=pts[i], p2=pts[i+1], p3=pts[Math.min(i+2,pts.length-1)];
    const c1x=p1.x+(p2.x-p0.x)/6, c1y=p1.y+(p2.y-p0.y)/6;
    const c2x=p2.x-(p3.x-p1.x)/6, c2y=p2.y-(p3.y-p1.y)/6;
    d+=` C ${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x},${p2.y}`;
  }
  return d;
}
function fmtRingkas(v){
  v=Math.round(Number(v)||0);
  const a=Math.abs(v);
  const f=(n,s)=>String(n).replace('.',',')+s;
  if(a>=1e9) return f(Number((v/1e9).toFixed(a%1e9?1:0)),'M');
  if(a>=1e6) return f(Number((v/1e6).toFixed(a%1e6?1:0)),'jt');
  if(a>=1e3) return f(Math.round(v/1e3),'rb');
  return String(v);
}
function renderOmzetChart(){
  const box=$('omzetChart'); if(!box) return;
  const {y, m}=omzetCursor();
  const data=omzetBulan();
  if($('omzetTitle')) $('omzetTitle').textContent='Performa Penjualan Bulan '+bulanLabel(y, m);
  const max=niceMax(Math.max(...data.map(d=>d.total), 0));
  const n=data.length;
  // Lebar grafik mengikuti layar: di HP muat penuh tanpa geser
  const avail=Math.round(box.getBoundingClientRect().width||box.clientWidth||340);
  const narrow=avail<520;
  const padL=narrow?46:66, padR=narrow?8:12, padT=16, padB=28;
  const step=Math.max(6, (avail-padL-padR)/Math.max(n,1));
  const W=Math.round(padL+padR+n*step), H=narrow?210:260, ch=H-padT-padB, baseY=padT+ch;
  const fs=Math.max(10, Math.min(13, Math.round(step*0.45)));
  const fx=Math.max(8, Math.min(11, Math.round(step*0.35)));
  const X=(i)=>padL+i*step+step/2;
  const Y=(v)=>padT+ch*(1-Math.min(v,max)/max);
  let grid='';
  for(let g=0;g<=4;g++){
    const v=max*g/4, gy=Y(v);
    grid+=`<line x1="${padL}" y1="${gy}" x2="${W-padR}" y2="${gy}" stroke="#e2e8f0"/><text x="${padL-6}" y="${gy+4}" text-anchor="end" font-size="${fs}" fill="#64748b">${narrow?fmtRingkas(v):Math.round(v).toLocaleString('id-ID')}</text>`;
  }
  grid+='<line x1="'+padL+'" y1="'+baseY+'" x2="'+(W-padR)+'" y2="'+baseY+'" stroke="#cbd5e1"/>';
  const pts=data.map((d,i)=>({x:X(i), y:Y(d.total)}));
  const line=smoothPath(pts);
  const area=line+` L ${X(n-1)},${baseY} L ${X(0)},${baseY} Z`;
  const dotR=narrow?7:10;
  const dots=data.map((d,i)=>d.total?`<circle cx="${X(i)}" cy="${Y(d.total)}" r="${dotR}" fill="transparent"><title>Tgl ${d.d} ${bulanLabel(y,m)} — Total ${fmtRp(d.total)} (service ${fmtRp(d.svc)} + barang ${fmtRp(d.jual)})</title></circle>`:'').join('');
  const every=Math.max(1, Math.ceil((fx*1.9)/Math.max(step,1)));
  const xl=data.map((d,i)=>i%every?'' : `<text x="${X(i)}" y="${H-8}" text-anchor="middle" font-size="${fx}" fill="#64748b">${narrow?d.d:String(d.d).padStart(2,'0')}</text>`).join('');
  box.innerHTML=`<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img"><defs><linearGradient id="omzGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6366f1" stop-opacity=".45"/><stop offset="1" stop-color="#6366f1" stop-opacity=".05"/></linearGradient></defs>${grid}<path d="${area}" fill="url(#omzGrad)"/><path d="${line}" fill="none" stroke="#4f46e5" stroke-width="${narrow?2:2.5}" stroke-linejoin="round" stroke-linecap="round"/>${dots}${xl}</svg>`;
  const tot=data.reduce((a,b)=>a+b.total,0);
  const peak=data.reduce((a,b)=>b.total>a.total?b:a, data[0]||{d:'-',total:0});
  if($('omzetInfo')) $('omzetInfo').textContent='Total '+bulanLabel(y,m)+': '+fmtRp(tot)+' • Rata-rata/hari: '+fmtRp(Math.round(tot/Math.max(n,1)))+(peak&&peak.total?' • Tertinggi tgl '+peak.d+' ('+fmtRp(peak.total)+')':'');
  const now=new Date();
  const isCur=(y===now.getFullYear()&&m===now.getMonth());
  if($('btnOmNext')) $('btnOmNext').disabled=isCur;
}
function omzetGeser(k){
  const c=omzetCursor();
  const d=new Date(c.y, c.m+k, 1);
  const now=new Date();
  if(d.getFullYear()>now.getFullYear()||(d.getFullYear()===now.getFullYear()&&d.getMonth()>now.getMonth())) return;
  omzetY=d.getFullYear(); omzetM=d.getMonth();
  renderOmzetChart();
}

// init (dengan guard login + auto backend)
(async function init(){
  await checkBackend(true);
  // Hint akun demo hanya relevan untuk pemakaian lokal. Di server publik
  // menampilkan kredensial default itu berbahaya (kredensial sudah diubah
  // owner, tapi tetap membocorkan username admin).
  if(BACKEND_OK){ const dh=$('demoHint'); if(dh) dh.classList.add('hidden'); }
  // Token kedaluwarsa / dicabut -> api.js sudah menghapus tokennya (event 401).
  // Tanpa ini user tersangkut di error 401 terus-menerus tanpa diminta login.
  try{
    window.addEventListener('servishp:401', ()=>{
      ME_CACHE=null; KAS=null;
      try{ showAuth(); }catch{}
      toast('Sesi berakhir. Silakan login kembali.', 4000);
    });
  }catch(e){}
  // coba pakai token tersimpan
  if(BACKEND_OK && backendToken()){
    try{
      const me = await window.API.me();
      ME_CACHE = me;
      setSession(me.id, !!localStorage.getItem('servishp_token_v1'));
      showApp(me);
      await refreshFromBackend();
      initTanggal(); renderAll();
      try{ if(typeof btInit==='function') btInit(); }catch{}
      return;
    }catch(e){ console.warn('token tidak valid:', e.message); }
  }
  const me=currentUser();
  if(me){ showApp(me); } else { showAuth(); }
  initTanggal(); renderAll();
  try{ if(typeof btInit==='function') btInit(); }catch{}
  // kalau backend hidup tapi belum login, tetap tarik status saja
})();

// ===== PRINTER BLUETOOTH THERMAL (APK via window.AndroidBT) =====
// Printer umum: XPrinter / RPP02 / 58mm, Bluetooth Classic SPP.
// Alur: Pairing di Settings Android -> buka Pengaturan > Printer -> Scan -> Sambungkan -> Tes Cetak.
// Struk diformat 32 kolom agar pas di kertas 58mm.
const LS_BT = 'servishp_bt_v1';
function btCfg(){ try{ return JSON.parse(localStorage.getItem(LS_BT))||{}; }catch{ return {}; } }
function btSaveCfg(p){ try{ localStorage.setItem(LS_BT, JSON.stringify(Object.assign(btCfg(), p))); }catch{} }
function hasNativeBT(){ return !!(window.AndroidBT && typeof window.AndroidBT.printText==='function'); }
function btParse(s, def){ try{ const j=JSON.parse(s); return (j&&typeof j==='object')?j:def; }catch{ return def; } }
function btRaw(fn){
  try{
    if(!hasNativeBT()) return null;
    const f=window.AndroidBT[fn];
    if(typeof f!=='function') return null;
    const args=Array.prototype.slice.call(arguments,1);
    return f.apply(window.AndroidBT, args);
  }catch(e){ console.warn('AndroidBT.'+fn+' gagal:', e); return null; }
}
function btStatusInfo(){
  const r=btRaw('status');
  return btParse(r, {ok:false, connected:false, name:'', mac:''});
}
// --- formatter 32 kolom ---
const STRUK_W = 32;
function sLine(ch){ ch=ch||'-'; return new Array(STRUK_W+1).join(ch); }
function sCenter(t){
  t=String(t==null?'':t);
  // potong halus per kata bila kepanjangan
  if(t.length>STRUK_W) t=t.slice(0,STRUK_W);
  const pad=Math.max(0, Math.floor((STRUK_W-t.length)/2));
  return new Array(pad+1).join(' ')+t;
}
function sLR(l, r){
  l=String(l==null?'':l); r=String(r==null?'':r);
  if(l.length+r.length+1>STRUK_W){
    const maxL=Math.max(4, STRUK_W-r.length-2);
    if(l.length>maxL) l=l.slice(0,maxL-1)+'.';
  }
  const sp=STRUK_W-l.length-r.length;
  return l+new Array(Math.max(sp,1)+1).join(' ')+r;
}
function sWrap(label, value){
  // "Label: value" dibungkus per 32 kolom agar tidak kepotong printer
  const full=(label?label:'')+(value==null?'':value);
  const out=[];
  let s=String(full);
  while(s.length>STRUK_W){ out.push(s.slice(0,STRUK_W)); s=s.slice(STRUK_W); }
  out.push(s);
  return out.join('\n');
}
function strukHead(){
  const L=[];
  L.push(sCenter(SET.nama||'POS Konter'));
  if(SET.alamat) String(SET.alamat).split('\n').forEach(a=>L.push(sCenter(a.trim().slice(0,32))));
  if(SET.telp) L.push(sCenter('Telp: '+SET.telp));
  L.push(sLine());
  return L.join('\n');
}
function strukFoot(){
  const L=[];
  L.push(sLine());
  if(SET.nota) {
    // bungkus catatan nota
    let s=String(SET.nota);
    while(s.length>STRUK_W){ L.push(s.slice(0,STRUK_W)); s=s.slice(STRUK_W); }
    L.push(s);
    L.push(sLine());
  }
  L.push(sCenter('Terima kasih 🙏'));
  L.push(sCenter('Dicetak '+new Date().toLocaleString('id-ID')));
  return L.join('\n');
}
function buildStrukService(x){
  const L=[strukHead()];
  L.push(sCenter('** NOTA SERVICE **'));
  L.push(sLR('No:', String(x.noService||'-').slice(0,18)));
  L.push(sLR('Masuk:', fmtTgl(x.tanggal)));
  L.push(sLR('Estimasi:', fmtTgl(x.estimasi)));
  L.push(sLine());
  L.push(sWrap('Plg: ', (x.nama||'-')+' ('+(x.telp||'-')+')'));
  if(x.alamat) L.push(sWrap('Alm: ', x.alamat));
  L.push(sWrap('Unit: ', (x.merk||'')+' '+(x.tipe||'')));
  if(x.sandi) L.push(sWrap('Sandi: ', x.sandi));
  L.push(sWrap('Lengkap: ', (x.kelengkapan||[]).join(', ')||'-'));
  L.push(sWrap('Keluhan: ', x.keluhan||'-'));
  if(x.kondisi) L.push(sWrap('Kondisi: ', x.kondisi));
  L.push(sLine());
  L.push(sLR('Biaya:', fmtRp(x.biaya)));
  L.push(sLR('Status:', normStatus(x.status)));
  L.push(sLR('Teknisi:', (x.teknisi||'-').slice(0,16)));
  L.push(strukFoot());
  return L.join('\n');
}
function buildStrukJual(x){
  const L=[strukHead()];
  L.push(sCenter('** NOTA PENJUALAN **'));
  L.push(sLR('No:', String(x.no_nota||'-').slice(0,18)));
  L.push(sLR('Tgl:', fmtTgl(x.tanggal)));
  L.push(sLR('Kasir:', String(x.kasir||'-').slice(0,16)));
  L.push(sLine());
  L.push(sWrap('Pbl: ', (x.pelanggan||'Umum')+(x.telp?' ('+x.telp+')':'')));
  L.push(sLR('Bayar:', (x.metode||'Tunai').slice(0,12)));
  L.push(sLine());
  (x.items||[]).forEach(it=>{
    let nm=String(it.nama||it.sku||'Item');
    if(nm.length>STRUK_W) nm=nm.slice(0,STRUK_W);
    L.push(nm);
    L.push(sLR(' '+it.qty+' x '+fmtRp(it.harga), fmtRp(it.subtotal)));
  });
  L.push(sLine());
  L.push(sLR('TOTAL:', fmtRp(x.total)));
  if(x.catatan) L.push(sWrap('Cat: ', x.catatan));
  L.push(strukFoot());
  return L.join('\n');
}
function buildStrukTest(){
  const L=[strukHead()];
  L.push(sCenter('** TES PRINTER **'));
  L.push(sCenter('12345678901234567890123456789012'));
  L.push(sLine('='));
  L.push(sLR('Kiri', 'Kanan'));
  L.push(sLine());
  L.push(sCenter('Jika tulisan ini rapi & terpotong'));
  L.push(sCenter('pas 32 kolom, printer siap dipakai.'));
  L.push(strukFoot());
  return L.join('\n');
}
// --- aksi cetak ---
function btPrintText(text){
  const r=btRaw('printText', String(text));
  const j=btParse(r, null);
  if(j && j.ok) return true;
  if(j && j.message) toast('BT: '+j.message);
  else toast('Gagal cetak via Bluetooth');
  return false;
}
// Dipanggil window.cetak(): true = sudah tercetak via BT (jangan window.print lagi)
function tryPrintServiceBT(x){
  const cfg=btCfg();
  if(!hasNativeBT()) return false;           // browser biasa -> fallback window.print
  const st=btStatusInfo();
  if(!st.connected){
    // coba auto-connect sekali ke MAC tersimpan
    if(cfg.mac){
      const r=btParse(btRaw('connect', cfg.mac), null);
      if(!(r&&r.ok)){ toast('Printer BT belum tersambung — sambungkan di Pengaturan > Printer 🖨'); return false; }
      try{ renderBtStatus(); }catch{}
    } else { toast('Belum ada printer BT — atur di Pengaturan > Printer 🖨'); return false; }
  }
  const ok=btPrintText(buildStrukService(x));
  if(ok) toast('Struk tercetak via Bluetooth 🖨');
  return ok;
}
function tryPrintJualBT(x){
  const cfg=btCfg();
  if(!hasNativeBT()) return false;
  const st=btStatusInfo();
  if(!st.connected){
    if(cfg.mac){
      const r=btParse(btRaw('connect', cfg.mac), null);
      if(!(r&&r.ok)){ toast('Printer BT belum tersambung — sambungkan di Pengaturan > Printer 🖨'); return false; }
      try{ renderBtStatus(); }catch{}
    } else { toast('Belum ada printer BT — atur di Pengaturan > Printer 🖨'); return false; }
  }
  const ok=btPrintText(buildStrukJual(x));
  if(ok) toast('Nota tercetak via Bluetooth 🖨');
  return ok;
}
// --- UI Pengaturan ---
function renderBtStatus(){
  const el=$('btStatus'); if(!el) return;
  if(!hasNativeBT()){
    el.textContent='📵 Mode browser — bluetooth hanya aktif di APK Android. Tetap bisa Cetak via print browser.';
    return;
  }
  const cfg=btCfg();
  const st=btStatusInfo();
  if(st.connected) el.textContent='🟢 Tersambung: '+(st.name||cfg.name||'printer')+' ('+(st.mac||cfg.mac)+')';
  else if(cfg.mac) el.textContent='🔴 Terputus — terakhir: '+(cfg.name||'')+' ('+cfg.mac+'). Klik Sambungkan.';
  else el.textContent='🔴 Belum tersambung — Scan lalu Sambungkan.';
}
function btRefreshSel(devices){
  const sel=$('btDevice'); if(!sel) return;
  const cfg=btCfg();
  sel.innerHTML=(devices||[]).map(d=>`<option value="${esc(d.mac)}" ${cfg.mac===d.mac?'selected':''}>${esc(d.name)} • ${esc(d.mac)}</option>`).join('')
    || '<option value="">(tidak ada perangkat paired)</option>';
}
function btScan(){
  if(!hasNativeBT()){ toast('Buka via APK untuk scan bluetooth'); return; }
  btRaw('requestPerms');
  toast('Memindai perangkat paired...');
  setTimeout(()=>{
    const r=btParse(btRaw('listPaired'), null);
    if(r&&r.ok){
      btRefreshSel(r.devices||[]);
      renderBtStatus();
      const n=(r.devices||[]).length;
      toast(n?n+' perangkat ditemukan ✅':'Tidak ada perangkat paired. Pairing dulu di Settings ⚙');
    } else {
      renderBtStatus();
      toast('Scan gagal: '+((r&&r.message)||'cek izin bluetooth'));
    }
  }, 600);
}
function btConnect(){
  if(!hasNativeBT()){ toast('Buka via APK untuk konek'); return; }
  const sel=$('btDevice');
  const mac=sel?sel.value:(btCfg().mac||'');
  if(!mac){ toast('Pilih perangkat dulu / Scan dulu'); return; }
  toast('Menyambungkan ke '+mac+'...');
  setTimeout(()=>{
    const r=btParse(btRaw('connect', mac), null);
    if(r&&r.ok){
      const name=(function(){ try{ const o=[...sel.options].find(o=>o.value===mac); return o?o.text.split(' • ')[0]:''; }catch{ return ''; } })();
      btSaveCfg({mac, name:name||r.name||''});
      try{ if(window.AndroidBT&&window.AndroidBT.autoConnect){} }catch{}
      renderBtStatus();
      toast('Tersambung ke '+(name||r.name||mac)+' 🖨✅');
    } else {
      renderBtStatus();
      toast('Gagal konek: '+((r&&r.message)||'coba lagi'));
    }
  }, 100);
}
function btDisconnect(){
  if(!hasNativeBT()) return;
  btRaw('disconnect');
  renderBtStatus();
  toast('Printer diputus');
}
function btTest(){
  if(!hasNativeBT()){ toast('Buka via APK untuk tes cetak'); return; }
  const st=btStatusInfo();
  if(!st.connected){ toast('Sambungkan printer dulu'); return; }
  if(btPrintText(buildStrukTest())) toast('Tes tercetak 🖨✅');
}
// Tes langsung dari sisi native (Android) - buat cek printer tanpa teks dari web
function btTestNative(){
  if(!hasNativeBT()){ toast('Buka via APK untuk tes cetak'); return; }
  const st=btStatusInfo();
  if(!st.connected){ toast('Sambungkan printer dulu'); return; }
  const r=btParse(btRaw('testPrint'), null);
  if(r&&r.ok) toast('Tes native tercetak 🖨✅');
  else toast('BT: '+((r&&r.message)||'gagal'));
}
function btInit(){
  renderBtStatus();
  const bP=$('btnBtPerm'); if(bP&&!bP.dataset.b){ bP.dataset.b='1'; bP.onclick=()=>{ btRaw('requestPerms'); toast('Izin bluetooth diminta — izinkan di popup HP'); setTimeout(renderBtStatus,800); }; }
  const bS=$('btnBtScan'); if(bS&&!bS.dataset.b){ bS.dataset.b='1'; bS.onclick=btScan; }
  const bC=$('btnBtConnect'); if(bC&&!bC.dataset.b){ bC.dataset.b='1'; bC.onclick=btConnect; }
  const bD=$('btnBtDisconnect'); if(bD&&!bD.dataset.b){ bD.dataset.b='1'; bD.onclick=btDisconnect; }
  const bT=$('btnBtTest'); if(bT&&!bT.dataset.b){ bT.dataset.b='1'; bT.onclick=btTest; }
  const bTN=$('btnBtTestNative'); if(bTN&&!bTN.dataset.b){ bTN.dataset.b='1'; bTN.onclick=btTestNative; }
  const sel=$('btDevice'); if(sel&&!sel.dataset.b){ sel.dataset.b='1'; sel.onchange=()=>{ const o=sel.options[sel.selectedIndex]; if(o&&sel.value) btSaveCfg({mac:sel.value, name:o.text.split(' • ')[0]}); }; }
  // auto-connect sekali saat aplikasi dibuka (APK) bila ada MAC tersimpan
  try{
    if(hasNativeBT()){
      const cfg=btCfg();
      const st=btStatusInfo();
      if(!st.connected&&cfg.mac){
        const r=btParse(btRaw('autoConnect'), null);
        if(r&&r.ok) setTimeout(renderBtStatus, 500);
      }
    }
  }catch{}
  setTimeout(renderBtStatus, 800);
}
window.btScan=btScan; window.btConnect=btConnect; window.btDisconnect=btDisconnect; window.btTest=btTest; window.btTestNative=btTestNative;
