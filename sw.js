/* Hanya aktif saat disajikan via http(s); dibuka via file:// diabaikan */
const CACHE = 'vita-v2-6-1';
const CORE = [
  './',
  './index.html',
  './css/tokens.css',
  './css/home.css',
  './css/game.css',
  './js/supabase.js',
  './js/home.js',
  './js/prologue.js',
  './js/game.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './screenshot-wide.png',
  './screenshot-narrow.png'
];
// version.json SENGAJA tidak di-cache: dibaca selalu fresh (no-store +
// query waktu) agar cek update dalam aplikasi tidak tertipu cache lama.

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url = null;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }
  if (url.origin !== self.location.origin) return;
  // version.json: selalu dari network agar versi update selalu akurat.
  if (url.pathname.endsWith('version.json')) return;

  // Network-First: selalu ambil file terbaru dari server/disk saat online.
  // Fallback ke cache jika offline.
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html')))
  );
});
