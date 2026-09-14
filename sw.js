/* IRPF service worker.
   The whole app is static: one page, one stylesheet, five scripts and a file
   of rates. Cache it all on install and serve cache-first, so the app opens
   instantly and works with no network at all.

   The parameters file is the one thing that changes without the code changing,
   so it is network-first with a cache fallback: a new rate reaches an open
   install on the next visit, and a dead network still gets last year's file.

   All paths are relative: the app lives in a repository subfolder on Pages. */

var VERSION = 'v1';
var SHELL_CACHE = 'irpf-shell-' + VERSION;
var DATA_CACHE = 'irpf-data-' + VERSION;
var PARAMS = 'data/es-2026.json';

var SHELL = [
  './',
  'index.html',
  'manifest.json',
  'css/app.css',
  'js/i18n.js',
  'js/engine.js',
  'js/analysis.js',
  'js/charts.js',
  'js/app.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      // addAll is all-or-nothing; add one by one so a single miss cannot
      // block the whole install.
      return Promise.all(
        SHELL.map(function (url) {
          return cache.add(new Request(url, { cache: 'reload' })).catch(function () {});
        }),
      );
    }).then(function () {
      return self.skipWaiting();
    }),
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (key) {
          if (key !== SHELL_CACHE && key !== DATA_CACHE) return caches.delete(key);
          return null;
        }),
      );
    }).then(function () {
      return self.clients.claim();
    }),
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.indexOf(PARAMS) !== -1) {
    event.respondWith(
      fetch(request)
        .then(function (response) {
          var copy = response.clone();
          caches.open(DATA_CACHE).then(function (cache) {
            cache.put(request, copy);
          });
          return response;
        })
        .catch(function () {
          return caches.match(request).then(function (cached) {
            return cached || new Response('{}', { headers: { 'content-type': 'application/json' } });
          });
        }),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(function (cached) {
      if (cached) return cached;
      return fetch(request)
        .then(function (response) {
          if (response && response.ok && response.type === 'basic') {
            var copy = response.clone();
            caches.open(SHELL_CACHE).then(function (cache) {
              cache.put(request, copy);
            });
          }
          return response;
        })
        .catch(function () {
          // A navigation with no network falls back to the shell.
          if (request.mode === 'navigate') return caches.match('index.html');
          return new Response('', { status: 504 });
        });
    }),
  );
});
