/* Service Worker — تخزين ملفات التطبيق للعمل دون إنترنت.
   عند إصدار نسخة جديدة: غيّر VERSION هنا وAPP_VERSION في config.js، وأضف أي ملف جديد إلى PRECACHE. */
const VERSION = '1.0.0';
const CACHE = `mizaniyati-shell-${VERSION}`;
const PRECACHE = [
  './', './index.html', './manifest.webmanifest', './style.css',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png',
  './app.js',
  './backup.js',
  './calc.js',
  './charts.js',
  './config.js',
  './dates.js',
  './db.js',
  './money.js',
  './page-bank-import.js',
  './page-emergency.js',
  './page-fixed.js',
  './page-home.js',
  './page-reports.js',
  './page-settings.js',
  './page-variable.js',
  './prefs.js',
  './schema.js',
  './sms.js',
  './store.js',
  './ui.js',
  './util.js',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: 'reload' يتجاوز كاش HTTP الخاص بـ GitHub Pages لضمان تنزيل أحدث الملفات
    await Promise.all(PRECACHE.map(async url => {
      const res = await fetch(new Request(url, { cache: 'reload' }));
      if (!res.ok) throw new Error(`precache failed: ${url} (${res.status})`);
      await cache.put(url, res);
    }));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('mizaniyati-shell-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'GET_VERSION' && event.source) event.source.postMessage({ type: 'VERSION', version: VERSION });
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
      try { return await fetch(req); } catch { return new Response('غير متصل', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch { return new Response('', { status: 503 }); }
  })());
});
