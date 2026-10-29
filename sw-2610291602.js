/* ServisHP Pro — Service Worker
 *
 * Fungsi:
 *   1. Cache shell frontend (index.html, style.css, script.js, api.js, config.js,
 *      icon) supaya app bisa dibuka & tampil walau jaringanjelek.
 *   2. JANGAN pernah cache response API (/api/*). Data transaksi harus selalu
 *      datang dari server supaya tidak menampilkan data basi.
 *   3. Network-first untuk navigasi (index.html) -> selalu coba server dulu,
 *      fallback ke cache kalau offline.
 *
 * Catatan: service worker hanya aktif di origin https (atau localhost).
 */
const CACHE = 'servishp-shell-v8';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './script-2610291602.js',
  './api.js',
  './config.js',
  './manifest.json',
  './icon.png',
  './icon-192.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => {
        clients.forEach((client) => {
          try {
            const p = client.navigate(client.url);
            if (p && p.catch) p.catch(() => undefined);
          } catch {}
        });
      })
  );
});

function isApi(url) {
  return url.pathname.startsWith('/api/') ||
         url.pathname.startsWith('/static/uploads/') ||
         url.pathname === '/openapi.json';
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // Google Fonts dll -> jangan disentuh

  // Data API & upload: selalu dari server, jangan pernah dari cache.
  if (isApi(url)) {
    e.respondWith(fetch(req).catch(() => new Response(
      JSON.stringify({ detail: 'Offline: data tidak bisa dimuat dari server.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )));
    return;
  }

  // Navigasi: network-first, fallback ke cache.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req, { cache: 'no-store' })
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || Response.error()))
    );
    return;
  }

  // Aset statis: cache-first, lalu refresh di belakang.
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
