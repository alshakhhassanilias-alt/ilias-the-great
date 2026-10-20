/* Offline support. Online: always fetch fresh files (bypassing the 10-minute
 * browser cache). Offline: serve the last good copy. Bump VERSION on release. */
var VERSION = 'waiter-v4';
var FILES = [
  './', './index.html', './manifest.webmanifest',
  './css/app.css?v=4', './js/menu-data.js?v=4', './js/logic.js?v=4', './js/store.js?v=4', './js/training.js?v=4', './js/app.js?v=4',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return c.addAll(FILES.map(function (f) { return new Request(f, { cache: 'reload' }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(function (res) {
    if (res.ok) {
      var copy = res.clone();
      caches.open(VERSION).then(function (c) { c.put(e.request, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(e.request).then(function (r) {
      return r || caches.match(e.request, { ignoreSearch: true }) || caches.match('./index.html');
    }).then(function (r) { return r || caches.match('./index.html'); });
  }));
});
