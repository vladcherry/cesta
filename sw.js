/* Cesta service worker.
   Shell: cache-first, so the app opens instantly and offline.
   Data:  network-first with a cache fallback, so a working network always wins
          and a dead one still shows yesterday's snapshot.
   All paths are relative: the app lives in a repository subfolder on Pages. */

var VERSION = 'v1';
var SHELL_CACHE = 'cesta-shell-' + VERSION;
var DATA_CACHE = 'cesta-data-' + VERSION;

var SHELL = [
  './',
  'index.html',
  'manifest.json',
  'css/app.css',
  'js/i18n.js',
  'js/store.js',
  'js/format.js',
  'js/demo.js',
  'js/data.js',
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

function isData(url) {
  return url.pathname.indexOf('/data/') !== -1;
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isData(url)) {
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

// Optional daily check. Chromium only, and only once the app is installed and
// the user has granted notifications — see the README.
self.addEventListener('periodicsync', function (event) {
  if (event.tag !== 'cesta-daily') return;
  event.waitUntil(checkForNewSnapshot());
});

function checkForNewSnapshot() {
  var url = new URL('data/latest.json', self.registration.scope);
  return caches.open(DATA_CACHE).then(function (cache) {
    return cache.match(url).then(function (cached) {
      return (cached ? cached.json() : Promise.resolve(null)).then(function (previous) {
        return fetch(url, { cache: 'no-store' }).then(function (response) {
          if (!response.ok) return null;
          var copy = response.clone();
          return response.json().then(function (fresh) {
            cache.put(url, copy);
            if (previous && previous.date === fresh.date) return null;
            return notify(fresh);
          });
        });
      });
    });
  }).catch(function () {
    return null;
  });
}

function notify(snapshot) {
  if (!self.registration.showNotification) return null;
  var cheapest = null;
  Object.keys(snapshot.totals || {}).forEach(function (storeId) {
    var totals = snapshot.totals[storeId];
    var value = totals.comparable === null ? totals.total : totals.comparable;
    if (value === null || value === undefined) return;
    if (!cheapest || value < cheapest.value) cheapest = { store: storeId, value: value };
  });
  var labels = {};
  (snapshot.stores || []).forEach(function (store) {
    labels[store.id] = store.label;
  });
  var body = cheapest
    ? labels[cheapest.store] + ': ' + cheapest.value.toFixed(2) + ' EUR'
    : snapshot.date;
  return self.registration.showNotification('Cesta', {
    body: body,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: 'cesta-daily',
  });
}

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i += 1) {
        if ('focus' in clientList[i]) return clientList[i].focus();
      }
      return self.clients.openWindow(self.registration.scope);
    }),
  );
});
