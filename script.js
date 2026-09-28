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
async function refreshFromBackend(){ await pullServices(); await pullSettings(); await pullSlides(); await pullSpareparts(); }
async function pullSlides(){
  if(!useBackend()) return false;
  try{
    const list = await window.API.listSlides();
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
  if(navP) navP.style.display = (r==='kasir') ? 'none' : '';
  if(navU) navU.style.display = isSuperAdmin() ? '' : 'none';
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
  if($('bottomNav')) $('bottomNav').classList.remove('hidden');
  applyRoleUI(); renderUsers();
}
function showAuth(){
  $('authScreen').classList.remove('hidden');
  $('mainApp').classList.add('hidden');
  if($('bottomNav')) $('bottomNav').classList.add('hidden');
  const ov=$('sidebarOverlay'); if(ov) ov.classList.remove('show');
  const sb=$('sidebar'); if(sb) sb.classList.remove('open');
}
function doLogout(){ clearSession(); showAuth(); toast('Berhasil keluar 👋'); }

const $ = (id) => document.getElementById(id);
// helper aman: ambil value walau elemen sudah dihapus (DP/IMEI/Warna)
const val = (id, def='') => { const el = document.getElementById(id); return el ? el.value : def; };
const fmtRp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const fmtTgl = (s) => { if(!s) return '-'; try{ const d=new Date(s); return d.toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'});}catch{return s;} };
const STATUS = ['Antri','Dikerjakan','Menunggu Sparepart','Selesai','Diambil','Batal'];

let DB = loadData();
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

function toast(msg){ const t=document.createElement('div'); t.className='toast'; t.textContent=msg; $('toastWrap').appendChild(t); setTimeout(()=>t.remove(),2500); }
function esc(s){ return String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function badge(st){ st = st || 'Antri'; return `<span class="badge b-${String(st).replace(/ /g,'-')}">${esc(st)}</span>`; }

// ===== NAVIGASI =====
document.querySelectorAll('.nav-btn').forEach(b=>b.addEventListener('click',()=>goto(b.dataset.page)));
document.querySelectorAll('[data-goto]').forEach(b=>b.addEventListener('click',()=>goto(b.dataset.goto)));
function goto(page){
  if(page==='pengaturan' && myRole()==='kasir'){ toast('⛔ Pengaturan khusus Admin / Super Admin'); return; }
  if(page==='pengguna' && !isSuperAdmin()){ toast('⛔ Kelola Pengguna khusus Super Admin'); return; }
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.page===page));
  document.querySelectorAll('#bottomNav button').forEach(b=>b.classList.toggle('active', b.dataset.page===page));
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  $('page-'+page).classList.add('active');
  $('sidebar').classList.remove('open');
  const ov=$('sidebarOverlay'); if(ov) ov.classList.remove('show');
  // Selalu tampilkan SEMUA data saat buka menu Data HP
  if(page==='data'){
    resetDataView();
    if(useBackend()){ pullServices().then(()=>{ renderAll(); }).catch(()=>{}); }
  }
  if(page==='dashboard' && useBackend()){ pullServices().then(()=>{ renderAll(); }).catch(()=>{}); }
  if(page==='sparepart'){ try{ renderSpareparts(); }catch{} if(useBackend()){ pullSpareparts().then(()=>{ renderAll(); }).catch(()=>{}); } }
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
$('openSidebar').onclick=()=>{ $('sidebar').classList.add('open'); const ov=$('sidebarOverlay'); if(ov) ov.classList.add('show'); };
$('closeSidebar').onclick=()=>{ $('sidebar').classList.remove('open'); const ov=$('sidebarOverlay'); if(ov) ov.classList.remove('show'); };
if($('sidebarOverlay')) $('sidebarOverlay').onclick=()=>{ $('sidebar').classList.remove('open'); $('sidebarOverlay').classList.remove('show'); };
document.querySelectorAll('#bottomNav button').forEach(b=>b.addEventListener('click',()=>goto(b.dataset.page)));

// ===== NOMOR SERVICE =====
function genNoService(){
  const d=new Date(); const y=d.getFullYear();
  const count=DB.filter(x=>String(x.noService).includes(String(y))).length+1;
  return `SVC-${y}-${String(count).padStart(4,'0')}`;
}
function refreshPreview(){ $('previewNoService').textContent = genNoService(); }

// ===== CHIPS KELENGKAPAN =====
document.querySelectorAll('#chipKelengkapan .chip').forEach(c=>c.addEventListener('click',()=>c.classList.toggle('on')));
function getKelengkapan(){ return [...document.querySelectorAll('#chipKelengkapan .chip.on')].map(c=>c.textContent.trim()); }
function clearChips(){ document.querySelectorAll('#chipKelengkapan .chip').forEach(c=>c.classList.remove('on')); }

// ===== FORM SIMPAN (backend-first, fallback lokal) =====
$('serviceForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
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
    status:val('f_status','Antri')
  };
  let savedNo = '';
  if(useBackend()){
    try{
      const created = await window.API.createService(payload);
      savedNo = created.noService;
      await pullServices();
    }catch(err){ toast('Backend gagal, simpan lokal: '+err.message); }
  }
  if(!savedNo){
    const item={ id: Date.now(), noService: genNoService(), ...payload, riwayat:[{t:new Date().toISOString(), s:payload.status}] };
    DB.unshift(item); saveData();
    savedNo = item.noService;
  }
  e.target.reset(); clearChips(); initTanggal(); refreshPreview();
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
$('btnResetForm').onclick=()=>{ $('serviceForm').reset(); clearChips(); initTanggal(); refreshPreview(); if($('previewNotaBox')) $('previewNotaBox').textContent='Belum ada preview. Isi form lalu klik Preview Nota.'; };
function initTanggal(){ const t=new Date().toISOString().slice(0,10); $('f_tanggal').value=t; const e=new Date(Date.now()+3*864e5).toISOString().slice(0,10); $('f_estimasi').value=e; }

// ===== RENDER =====
function filtered(){
  let r=[...DB];
  const q=(($('globalSearch') && $('globalSearch').value)||'').toLowerCase().trim();
  if(q) r=r.filter(x=>[(x.noService||''),(x.nama||''),(x.telp||''),(x.merk||''),(x.tipe||''),(x.keluhan||'')].join(' ').toLowerCase().includes(q));
  if(activeFilter!=='Semua') r=r.filter(x=>(x.status||'Antri')===activeFilter);
  const s=$('sortData') ? $('sortData').value : 'baru';
  if(s==='baru') r.sort((a,b)=>(b.id||0)-(a.id||0));
  if(s==='lama') r.sort((a,b)=>(a.id||0)-(b.id||0));
  if(s==='nama') r.sort((a,b)=>String(a.nama||'').localeCompare(String(b.nama||'')));
  return r;
}

function renderAll(){ renderStats(); renderRecent(); renderData(); renderQueue(); renderSettingUI(); refreshPreview(); renderUsers(); renderHeadbar(); renderSlideManager(); renderSpareparts(); }

function renderStats(){
  const c=(s)=>DB.filter(x=>x.status===s).length;
  $('stTotal').textContent=DB.length;
  $('stAntri').textContent=c('Antri');
  $('stProses').textContent=c('Dikerjakan')+c('Menunggu Sparepart');
  $('stSelesai').textContent=c('Selesai')+c('Diambil');
  $('stOmzet').textContent=fmtRp(DB.filter(x=>x.status!=='Batal').reduce((a,b)=>a+Number(b.biaya||0),0));
  const total=Math.max(DB.length,1);
  $('statusChart').innerHTML=STATUS.map(s=>{
    const n=c(s), p=Math.round(n/total*100);
    return `<div><div class="status-row"><span>${s}</span><span>${n}</span></div><div class="bar"><i style="width:${p}%"></i></div></div>`;
  }).join('');
  const lama=DB.filter(x=>!['Selesai','Diambil','Batal'].includes(x.status)).slice(0,5);
  const lowSp=(typeof SPARE!=='undefined'?SPARE:[]).filter(x=>Number(x.stok||0)<=Number(x.stok_min||0)).slice(0,3);
  const lowHtml=lowSp.map(x=>`<div class="att-item"><b>🔧 ${esc(x.sku)}</b> • ${esc(x.nama)}<br><small>Stok ${esc(x.stok)} / min ${esc(x.stok_min)}</small><br><span class="badge b-Batal">Stok Menipis</span></div>`).join('');
  const lamaHtml=lama.map(x=>`<div class="att-item"><b>${esc(x.noService)}</b> • ${esc(x.nama)}<br><small>${esc(x.merk)} ${esc(x.tipe)} — ${esc(String(x.keluhan||'').slice(0,50))}</small><br>${badge(x.status)}</div>`).join('');
  $('attentionList').innerHTML = (lamaHtml+lowHtml) || '<small class="muted">Semua aman, tidak ada antrian. 🎉</small>';
}

function renderRecent(){
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
    return `<tr>
      <td><b>${esc(x.noService)}</b><br><small class="muted">${fmtTgl(x.tanggal)}</small></td>
      <td>${esc(x.nama)}<br><small class="muted">${esc(x.telp)}</small></td>
      <td><b>${esc(x.merk)} ${esc(x.tipe)}</b></td>
      <td><small>${esc(keluhan.slice(0,40))}${keluhan.length>40?'...':''}</small></td>
      <td><b>${fmtRp(x.biaya)}</b></td>
      <td>${badge(x.status)}</td>
      <td><div class="act-btns">
        <button class="icon-btn" onclick="detail(${x.id})" title="Detail">👁</button>
        <button class="icon-btn" onclick="cetak(${x.id})" title="Nota">🖨</button>
        ${isAdminUp() ? `<button class="icon-btn" onclick="edit(${x.id})" title="Edit">✏️</button>
        <button class="icon-btn" onclick="hapus(${x.id})" title="Hapus">🗑</button>` : ``}
      </div></td></tr>`;
  }).join('');
}

// filter + search + sort
document.querySelectorAll('.fbtn').forEach(b=>b.onclick=()=>{ document.querySelectorAll('.fbtn').forEach(x=>x.classList.remove('active')); b.classList.add('active'); activeFilter=b.dataset.filter; renderData(); });
$('globalSearch').addEventListener('input',()=>{ renderData(); });
$('sortData').onchange=renderData;
if($('btnTampilSemua')) $('btnTampilSemua').onclick=()=>{ resetDataView(); toast('Menampilkan semua data HP ✅'); };

// ===== DETAIL =====
window.detail=function(id){
  const x=DB.find(d=>d.id===id); if(!x) return;
  $('detailTitle').textContent='Detail '+x.noService;
  $('detailBody').innerHTML=`
    <div style="margin-bottom:10px">${badge(x.status)}</div>
    <div class="kv"><b>Pelanggan</b><span>${esc(x.nama)} • ${esc(x.telp)}<br><small>${esc(x.alamat||'-')}</small></span></div>
    <div class="kv"><b>Unit HP</b><span>${esc(x.merk)} ${esc(x.tipe)}<br><small>Sandi: ${esc(x.sandi||'-')}</small></span></div>
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
    <button class="btn ghost" onclick="cetak(${x.id})">🖨 Cetak Nota</button>
    ${isAdminUp() ? `<button class="btn ghost" onclick="edit(${x.id})">✏️ Edit</button>` : ``}
    <button class="btn primary" onclick="saveStatus(${x.id})">Simpan Status</button>`;
  $('modalDetail').classList.remove('hidden');
};
window.saveStatus=async function(id){
  const x=DB.find(d=>d.id===id); const ns=$('quickStatus').value;
  if(useBackend()){
    try{ await window.API.setStatus(id, ns); await pullServices(); renderAll(); $('modalDetail').classList.add('hidden'); toast('Status → '+ns); return; }
    catch(err){ toast('Backend gagal: '+err.message); }
  }
  if(!x) return;
  x.status=ns; x.riwayat=x.riwayat||[]; x.riwayat.push({t:new Date().toISOString(),s:ns});
  saveData(); renderAll(); $('modalDetail').classList.add('hidden'); toast('Status → '+ns);
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
  ['modalDetail','modalEdit','modalSpare'].forEach(id=>{ const m=$(id); if(m) m.classList.add('hidden'); });
  if(typeof closeScan==='function'){
    try{
      const ms=$('modalScan');
      if(ms && !ms.classList.contains('hidden')) closeScan();
    }catch{}
  } else {
    const ms=$('modalScan'); if(ms) ms.classList.add('hidden');
  }
}
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
  const order=['Antri','Dikerjakan','Menunggu Sparepart','Selesai','Diambil'];
  if(cur==='Batal') return `<div class="result-card">❌ Service <b dibatalkan</b>.</div>`;
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
      <div class="btn-row"><button class="btn small" onclick="cetak(${x.id})">🖨 Nota</button><button class="btn small" onclick="detail(${x.id})">👁 Detail</button></div>
    </div>`;
  }).join('');
}
$('btnLacak').onclick=doLacak;
$('lacakInput').addEventListener('keydown',(e)=>{ if(e.key==='Enter') doLacak(); });
function renderQueue(){
  const q=DB.filter(x=>!['Diambil','Batal'].includes(x.status));
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
    status: val('f_status','Antri')
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
  $('printArea').innerHTML = notaHTML(item);
  window.print();
};

// ===== CSV / BACKUP =====
function toCSV(){
  const h=['NoService','Tanggal','Nama','Telp','Merk','Tipe','Keluhan','Biaya','Status','Teknisi'];
  const rows=DB.map(x=>[x.noService,x.tanggal,x.nama,x.telp,x.merk,x.tipe,'"'+String(x.keluhan||'').replace(/"/g,'""')+'"',x.biaya,x.status,x.teknisi].join(','));
  return h.join(',')+'\n'+rows.join('\n');
}
function download(name, content, type='text/plain'){
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; a.click();
}
$('btnExportCSV').onclick=()=>download('data-service.csv',toCSV(),'text/csv');
$('btnExportCSV2').onclick=()=>download('data-service.csv',toCSV(),'text/csv');
$('btnBackup').onclick=()=>download('backup-servishp.json',JSON.stringify({setting:SET,data:DB},null,2),'application/json');
$('restoreFile').addEventListener('change',(e)=>{
  if(!needSuperAdmin()){ e.target.value=''; return; }
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=()=>{ try{ const j=JSON.parse(r.result); if(j.data){DB=j.data;} else if(Array.isArray(j)){DB=j;} if(j.setting){SET=j.setting;} saveData(); saveSetting(); renderAll(); toast('Restore berhasil ✅'); }catch{ toast('File tidak valid!'); } };
  r.readAsText(f);
});

// ===== PENGATURAN =====
function fillTeknisi(sel, val){ sel.innerHTML=(SET.teknisi||[]).map(t=>`<option ${t===val?'selected':''}>${esc(t)}</option>`).join(''); }
function renderSettingUI(){
  $('brandName').textContent=SET.nama.split('-')[0].trim()||'ServisHP Pro';
  $('sideKonter').textContent=SET.nama; $('sideKonterAlamat').textContent=SET.alamat;
  $('s_nama').value=SET.nama; $('s_alamat').value=SET.alamat; $('s_telp').value=SET.telp; $('s_nota').value=SET.nota;
  fillTeknisi($('f_teknisi')); fillTeknisi($('e_teknisi'));
  $('listMerk').innerHTML=(SET.merk||[]).map(m=>`<option value="${esc(m)}">`).join('');
  $('teknisiList').innerHTML=(SET.teknisi||[]).map((t,i)=>`<span class="pill">${esc(t)}<button onclick="delTeknisi(${i})">✕</button></span>`).join('');
  $('merkList').innerHTML=(SET.merk||[]).map((m,i)=>`<span class="pill">${esc(m)}<button onclick="delMerk(${i})">✕</button></span>`).join('');
}
$('btnSaveSetting').onclick=async ()=>{
  if(!needAdmin()) return;
  const payload={ nama:$('s_nama').value||SET.nama, alamat:$('s_alamat').value, telp:$('s_telp').value, nota:$('s_nota').value };
  if(useBackend()){
    try{ await window.API.updateSettings(payload); await pullSettings(); renderSettingUI(); toast('Pengaturan disimpan ✅'); return; }
    catch(err){ toast('Backend gagal: '+err.message); return; }
  }
  Object.assign(SET, payload);
  saveSetting(); renderSettingUI(); toast('Pengaturan disimpan ✅');
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
    const img=fullImageUrl(s.image_url);
    const bg=img?`background-image:url('${esc(img)}')`:`background:linear-gradient(135deg,#2563eb,#7c3aed)`;
    const inner=`<div class="shade"></div><div class="cap"><h2>${esc(s.judul||'Promo')}</h2><p>${esc(s.subjudul||'')}</p></div>`;
    return s.link
      ? `<a class="headbar-slide" style="${bg}" href="${esc(s.link)}" target="_blank" rel="noopener">${inner}</a>`
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
    ${canEdit?`<button onclick="toggleSlide(${s.id!==undefined?s.id:i},${i})" title="Aktif/Nonaktif">👁</button><button onclick="delSlide(${s.id!==undefined?s.id:i},${i})">✕</button>`:''}</span>`).join('')
    || '<small class="muted">Belum ada slide.</small>';
}
window.toggleSlide=async (id, idx)=>{
  if(!needAdmin()) return;
  if(useBackend() && typeof id==='number'){
    try{ const cur=(SLIDES||[])[idx]; await window.API.updateSlide(id,{aktif:!(cur&&cur.aktif!==false)}); await refreshSlideManager(); return; }
    catch(err){ toast('Backend gagal: '+err.message); return; }
  }
  const s=SLIDES[idx]; if(!s) return; s.aktif=!(s.aktif!==false); saveSlidesLocal(); renderHeadbar(); renderSlideManager();
};
window.delSlide=async (id, idx)=>{
  if(!needAdmin()) return;
  if(!confirm('Hapus slide ini?')) return;
  if(useBackend() && typeof id==='number'){
    try{ await window.API.deleteSlide(id); await refreshSlideManager(); toast('Slide dihapus'); return; }
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
  SLIDES.push({id:Date.now(), judul, subjudul, image_url, urutan:SLIDES.length, aktif:true});
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
$('btnHapusSelesai').onclick=()=>{ if(!needAdmin()) return; if(!confirm('Hapus semua data berstatus Diambil/Selesai?')) return; DB=DB.filter(x=>!['Diambil','Selesai'].includes(x.status)); saveData(); renderAll(); toast('Data selesai dihapus'); };
$('btnHapusSemua').onclick=()=>{ if(!needSuperAdmin()) return; if(!confirm('HAPUS SEMUA DATA? Tindakan ini tidak bisa dibatalkan!')) return; if(!confirm('Yakin 100%? Ketik OK untuk lanjut.') ) return; DB=[]; saveData(); renderAll(); toast('Semua data dihapus'); };

// ===== SEED CONTOH (pertama kali) =====
if(!localStorage.getItem('servishp_seeded')){
  DB=[
    {id:1,noService:'SVC-2026-0001',tanggal:new Date().toISOString().slice(0,10),nama:'Budi Santoso',telp:'08123456789',alamat:'Jl. Melati No.5',merk:'Samsung',tipe:'Galaxy A12',warna:'Hitam',imei:'',sandi:'1234',kelengkapan:['HP Saja','Charger'],keluhan:'LCD pecah, sentuh sebagian tidak respon',kondisi:'Lecet pemakaian',teknisi:'Andi',biaya:350000,dp:100000,estimasi:new Date(Date.now()+3*864e5).toISOString().slice(0,10),catatan:'Ganti LCD original',status:'Dikerjakan',riwayat:[{t:new Date().toISOString(),s:'Antri'},{t:new Date().toISOString(),s:'Dikerjakan'}]},
    {id:2,noService:'SVC-2026-0002',tanggal:new Date().toISOString().slice(0,10),nama:'Siti Aminah',telp:'08234567890',alamat:'Jl. Kenanga No.3',merk:'Xiaomi',tipe:'Redmi 12C',warna:'Biru',imei:'',sandi:'-',kelengkapan:['HP Saja'],keluhan:'Baterai ngedrop, cepat panas',kondisi:'Mulus',teknisi:'Budi',biaya:150000,dp:0,estimasi:new Date(Date.now()+2*864e5).toISOString().slice(0,10),catatan:'',status:'Antri',riwayat:[{t:new Date().toISOString(),s:'Antri'}]}
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
  const np=prompt('Reset password.\nMasukkan password baru (min. 6):');
  if(!np) return;
  if(np.length<6){ toast('Password minimal 6 karakter'); return; }
  if(BACKEND_OK && window.API){
    try{ await window.API.req('/auth/forgot?identifier='+encodeURIComponent(id)+'&new_password='+encodeURIComponent(np), {method:'POST'}); toast('Password berhasil direset ✅ Silakan login'); return; }
    catch(err){ toast('Reset gagal: '+err.message); return; }
  }
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
        pw=$('r_pw').value, pw2=$('r_pw2').value, role=$('r_role').value||'kasir';
  if(!['kasir','admin','superadmin'].includes(role)){ toast('Role tidak valid'); return; }
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
          <button class="icon-btn" onclick="resetUserPw(${u.id})" title="Reset password">🔑</button>
          <button class="icon-btn" onclick="deleteUser(${u.id})" title="Hapus">🗑</button>
        </div></td></tr>`).join('')||'<tr><td colspan="4">Belum ada pengguna</td></tr>');
  };
  if(useBackend()){
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
let SPARE = loadSpareLocal();
let spLowOnly = false;
let spEditId = null;
let scanStream = null;
let scanRaf = null;

function loadSpareLocal(){ try{ return JSON.parse(localStorage.getItem(LS_SPARE)) || []; }catch{ return []; } }
function saveSpareLocal(){ try{ localStorage.setItem(LS_SPARE, JSON.stringify(SPARE)); }catch{} }
if(!localStorage.getItem(LS_SPARE)){
  SPARE=[
    {id:1, nama:'LCD Samsung A12', sku:'LCD-SSA12', merk:'Samsung', hpp:180000, harga_jual:250000, stok:8, stok_min:3},
    {id:2, nama:'Baterai Redmi 12C', sku:'BAT-R12C', merk:'Xiaomi', hpp:65000, harga_jual:95000, stok:2, stok_min:5},
    {id:3, nama:'Charger 25W USB-C', sku:'CHR-25WC', merk:'Samsung', hpp:45000, harga_jual:75000, stok:15, stok_min:5},
  ];
  saveSpareLocal();
}
async function pullSpareparts(){
  if(!useBackend()) return false;
  try{
    const list = await window.API.listSpareparts({limit:1000, sort:'nama'});
    SPARE = Array.isArray(list) ? list : [];
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
  const q=(($('spSearch') && $('spSearch').value)||'').toLowerCase().trim();
  let r=[...SPARE];
  if(spLowOnly) r=r.filter(x=>Number(x.stok||0)<=Number(x.stok_min||0));
  if(q) r=r.filter(x=>[(x.nama||''),(x.sku||''),(x.merk||'')].join(' ').toLowerCase().includes(q));
  const s=$('spSort') ? $('spSort').value : 'nama';
  if(s==='sku') r.sort((a,b)=>String(a.sku||'').localeCompare(String(b.sku||'')));
  else if(s==='stok') r.sort((a,b)=>Number(a.stok||0)-Number(b.stok||0));
  else r.sort((a,b)=>String(a.nama||'').localeCompare(String(b.nama||'')));
  const low=SPARE.filter(x=>Number(x.stok||0)<=Number(x.stok_min||0)).length;
  const nilai=SPARE.reduce((a,b)=>a+Number(b.hpp||0)*Number(b.stok||0),0);
  if($('spTotal')) $('spTotal').textContent=SPARE.length;
  if($('spNilai')) $('spNilai').textContent=fmtRp(nilai);
  if($('spLow')) $('spLow').textContent=low;
  if($('spCount')) $('spCount').textContent=SPARE.length+' item';
  if($('spInfo')) $('spInfo').textContent = spLowOnly ? `• menampilkan ${r.length} stok menipis` : (low?`• ${low} stok menipis`:'' );
  $('emptySpare').classList.toggle('hidden', r.length>0);
  // Kasir boleh lihat + ubah stok, tapi TIDAK boleh tambah/edit/hapus sparepart
  const admin=isAdminUp();
  const bAdd=$('btnAddSpare'), bAddBtm=$('btnAddSpareBottom');
  if(bAdd) bAdd.style.display=admin?'':'none';
  if(bAddBtm) bAddBtm.style.display=admin?'':'none';
  if(!r.length){ $('spTable').innerHTML=''; return; }
  $('spTable').innerHTML=r.map(x=>{
    const isLow=Number(x.stok||0)<=Number(x.stok_min||0);
    const sid=esc(String(x.id));
    return `<tr>
      <td><b>${esc(x.sku)}</b></td>
      <td><b>${esc(x.nama)}</b><br><small class="muted">Margin: ${esc(spMargin(x))}</small></td>
      <td>${esc(x.merk||'-')}</td>
      <td>${fmtRp(x.hpp)}</td>
      <td><b>${fmtRp(x.harga_jual)}</b></td>
      <td><b>${esc(x.stok)}</b><small class="muted"> / min ${esc(x.stok_min)}</small><br>${isLow?'<span class="badge b-Batal">Menipis</span>':'<span class="badge b-Selesai">Aman</span>'}</td>
      <td><div class="act-btns">
        <button class="icon-btn" onclick="spStock('${sid}',-1)" title="Kurangi 1">−</button>
        <button class="icon-btn" onclick="spStock('${sid}',1)" title="Tambah 1">+</button>
        ${admin?`<button class="icon-btn" onclick="spEdit('${sid}')" title="Edit">✏️</button>
        <button class="icon-btn" onclick="spHapus('${sid}')" title="Hapus">🗑</button>`:''}
      </div></td></tr>`;
  }).join('');
}
function findSpare(id){ return SPARE.find(d=>String(d.id)===String(id)); }
if($('spSearch')) $('spSearch').addEventListener('input',()=>renderSpareparts());
if($('spSort')) $('spSort').onchange=renderSpareparts;
if($('spLowBtn')) $('spLowBtn').onclick=()=>{
  spLowOnly=!spLowOnly;
  $('spLowBtn').classList.toggle('active', spLowOnly);
  renderSpareparts();
};
function openSpareModal(){
  if(!needAdmin()) return;
  spEditId=null;
  $('spareTitle').textContent='Tambah Sparepart';
  $('sp_nama').value=''; $('sp_sku').value=''; $('sp_merk').value='';
  $('sp_hpp').value=0; $('sp_jual').value=0; $('sp_stok').value=0; $('sp_min').value=0;
  updSpMargin();
  $('modalSpare').classList.remove('hidden');
  setTimeout(()=>{ const el=$('sp_nama'); if(el) el.focus(); },50);
}
if($('btnAddSpare')) $('btnAddSpare').onclick=openSpareModal;
if($('btnAddSpareBottom')) $('btnAddSpareBottom').onclick=openSpareModal;
function updSpMargin(){
  const hpp=Number(($('sp_hpp')||{}).value||0), jual=Number(($('sp_jual')||{}).value||0);
  if($('spMargin')) $('spMargin').textContent = hpp>0 ? `Margin: ${fmtRp(jual-hpp)} (${(jual-hpp>=0?'+':'')+Math.round((jual-hpp)/hpp*100)}%)` : '';
}
if($('sp_hpp')) $('sp_hpp').addEventListener('input',updSpMargin);
if($('sp_jual')) $('sp_jual').addEventListener('input',updSpMargin);
window.spEdit=function(id){
  if(!needAdmin()) return;
  const x=findSpare(id); if(!x){ toast('Data tidak ditemukan'); return; } spEditId=x.id;
  $('spareTitle').textContent='Edit Sparepart';
  $('sp_nama').value=x.nama; $('sp_sku').value=x.sku; $('sp_merk').value=x.merk||'';
  $('sp_hpp').value=x.hpp||0; $('sp_jual').value=x.harga_jual||0; $('sp_stok').value=x.stok||0; $('sp_min').value=x.stok_min||0;
  updSpMargin();
  $('modalSpare').classList.remove('hidden');
};
if($('btnSaveSpare')) $('btnSaveSpare').onclick=async ()=>{
  if(!needAdmin()) return;
  const nama=$('sp_nama').value.trim(), sku=$('sp_sku').value.trim(), merk=$('sp_merk').value.trim();
  const hpp=Number($('sp_hpp').value||0), jual=Number($('sp_jual').value||0);
  const stok=Number($('sp_stok').value||0), smin=Number($('sp_min').value||0);
  if(!nama||!sku){ toast('Nama + SKU wajib diisi'); return; }
  const isEdit=(spEditId!==null && spEditId!==undefined);
  if(useBackend()){
    try{
      if(isEdit) await window.API.updateSparepart(spEditId,{nama,sku,merk,hpp,harga_jual:jual,stok,stok_min:smin});
      else await window.API.createSparepart({nama,sku,merk,hpp,harga_jual:jual,stok,stok_min:smin});
      $('modalSpare').classList.add('hidden');
      await pullSpareparts(); renderAll();
      toast('Sparepart tersimpan ✅'); return;
    }catch(err){ toast(err.message); return; }
  }
  if(spEditId!==null && spEditId!==undefined){
    const x=findSpare(spEditId); if(!x){ toast('Data tidak ditemukan'); return; }
    if(SPARE.some(d=>String(d.id)!==String(spEditId)&&String(d.sku).toLowerCase()===sku.toLowerCase())){ toast('SKU sudah dipakai'); return; }
    Object.assign(x,{nama,sku,merk,hpp,harga_jual:jual,stok,stok_min:smin});
  } else {
    if(SPARE.some(d=>String(d.sku).toLowerCase()===sku.toLowerCase())){ toast('SKU sudah dipakai'); return; }
    SPARE.push({id:Date.now(),nama,sku,merk,hpp,harga_jual:jual,stok,stok_min:smin});
  }
  saveSpareLocal();
  $('modalSpare').classList.add('hidden');
  renderAll(); toast('Sparepart tersimpan ✅');
};
window.spHapus=async function(id){
  if(!needAdmin()) return;
  const x=findSpare(id); if(!x){ toast('Data tidak ditemukan'); return; }
  if(!confirm('Hapus '+x.nama+' ('+x.sku+')?')) return;
  if(useBackend()){
    try{ await window.API.deleteSparepart(x.id); await pullSpareparts(); renderAll(); toast('Sparepart dihapus'); return; }
    catch(err){ toast(err.message); return; }
  }
  SPARE=SPARE.filter(d=>String(d.id)!==String(x.id)); saveSpareLocal(); renderAll(); toast('Sparepart dihapus');
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
if($('btnScanSku')) $('btnScanSku').onclick=()=>openScan();
async function openScan(){
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
            if(v){ $('sp_sku').value=v; toast('SKU: '+v+' ✅'); stop(); tryLookupSku(v); return; }
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

// init (dengan guard login + auto backend)
(async function init(){
  await checkBackend(true);
  // coba pakai token tersimpan
  if(BACKEND_OK && backendToken()){
    try{
      const me = await window.API.me();
      ME_CACHE = me;
      setSession(me.id, !!localStorage.getItem('servishp_token_v1'));
      showApp(me);
      await refreshFromBackend();
      initTanggal(); renderAll();
      return;
    }catch(e){ console.warn('token tidak valid:', e.message); }
  }
  const me=currentUser();
  if(me){ showApp(me); } else { showAuth(); }
  initTanggal(); renderAll();
  // kalau backend hidup tapi belum login, tetap tarik status saja
})();
