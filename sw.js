// Tsuki Reader service worker: precache the app shell so it works fully offline.
const VERSION = 'tsuki-v1.0.0';
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/db.js', 'js/docreader.js', 'js/formats.js', 'js/icons.js', 'js/importer.js', 'js/reader.js', 'js/state.js', 'js/util.js',
  'vendor/jszip.min.js', 'vendor/libarchive.js', 'vendor/worker-bundle.js', 'vendor/libarchive.wasm',
  'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs', 'vendor/mammoth.browser.min.js', 'vendor/marked.min.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('index.html')));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return res;
  })));
});
