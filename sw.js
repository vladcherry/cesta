/* IRPF service worker.

   Network first, cache as the fallback — for everything. The app is a few
   small static files, so a fresh copy costs nothing, and cache-first had a
   nasty failure: the page is usually opened with a query string, which never
   matched the cached page, so a deploy delivered the new HTML together with
   the previous release's scripts from the cache — a new tab with no strings.
   Serving the network first keeps the page and its scripts from the same
   release; the cache only answers when there is no network at all.

   All paths are relative: the app lives in a repository subfolder on Pages. */

var VERSION = 'v2';
var CACHE = 'irpf-' + VERSION;

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
  'data/es-2026.json',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
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
      // Every older cache goes, including the cache-first ones of v1.
      return Promise.all(keys.map(function (key) {
        return key === CACHE ? null : caches.delete(key);
      }));
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

  event.respondWith(
    fetch(request)
      .then(function (response) {
        if (response && response.ok && response.type === 'basic') {
          var copy = response.clone();
          caches.open(CACHE).then(function (cache) {
            cache.put(request, copy);
          });
        }
        return response;
      })
      .catch(function () {
        // Offline. The query string only carries view state, so any cached
        // copy of the page will do for a navigation.
        return caches.match(request, { ignoreSearch: request.mode === 'navigate' }).then(function (cached) {
          if (cached) return cached;
          if (request.mode === 'navigate') return caches.match('index.html');
          return new Response('', { status: 504 });
        });
      }),
  );
});
