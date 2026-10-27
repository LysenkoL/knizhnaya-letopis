// Офлайн-режим: приложение открывается и без интернета.
// При изменении файлов приложения увеличьте номер версии.
const VERSION = 'letopis-v6';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'js/app.js',
  'js/db.js',
  'js/lookup.js',
  'js/scanner.js',
  'js/sync.js',
  'vendor/zxing-browser.min.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/favicon.png',
  'icons/apple-touch-icon.png',
  'fonts/nunito-cyrillic-400-normal.woff2',
  'fonts/nunito-cyrillic-700-normal.woff2',
  'fonts/nunito-cyrillic-800-normal.woff2',
  'fonts/nunito-latin-400-normal.woff2',
  'fonts/nunito-latin-700-normal.woff2',
  'fonts/nunito-latin-800-normal.woff2',
  'fonts/nunito-latin-ext-400-normal.woff2',
  'fonts/nunito-latin-ext-700-normal.woff2',
  'fonts/nunito-latin-ext-800-normal.woff2',
  'fonts/caveat-cyrillic-700-normal.woff2',
  'fonts/caveat-latin-700-normal.woff2',
  'fonts/caveat-latin-ext-700-normal.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Свои файлы: сразу из кэша, параллельно обновляем из сети.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req).then((res) => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
