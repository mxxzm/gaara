/* gaara. service worker: keeps the app available offline.
   - the page itself: network first (so updates arrive as soon as you are online), cached copy when offline or slow
   - icon and other same-origin files: cached copy straight away, refreshed in the background
   GitHub sync requests are on another origin and are never touched here. */
var CACHE = 'gaara-v3';
var PRECACHE = ['./', 'index.html', 'apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(PRECACHE.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (ks) {
      return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* the page tells us its own URL, so it is cached whatever the file ends up being called */
self.addEventListener('message', function (e) {
  var d = e.data;
  if (d && d.t === 'page' && typeof d.u === 'string') {
    try {
      var u = new URL(d.u);
      if (u.origin === self.location.origin) {
        e.waitUntil(caches.open(CACHE).then(function (c) {
          return c.add(new Request(u.href, { cache: 'reload' })).catch(function () {});
        }));
      }
    } catch (err) {}
  }
});

/* only store complete, normal responses (never errors, redirects or partial 206 content) */
function put(req, res) {
  if (!res || res.status !== 200) return Promise.resolve();
  return caches.open(CACHE).then(function (c) { return c.put(req, res); }).catch(function () {});
}

function networkFirst(e) {
  var req = e.request;
  return new Promise(function (resolve) {
    var done = false;
    var settle = function (r) { if (!done) { done = true; resolve(r); } };
    var fallback = function () {
      return caches.match(req, { ignoreSearch: true })
        .then(function (r) { return r || caches.match('index.html'); })
        .then(function (r) { return r || caches.match('./'); });
    };
    /* slow network: show the cached copy now, the fetch below still finishes and refreshes the cache */
    var timer = setTimeout(function () {
      fallback().then(function (r) { if (r) settle(r); });
    }, 3500);
    /* 'no-cache' = always check with the server, so an update is never hidden behind the browser's HTTP cache */
    var work = fetch(req, { cache: 'no-cache' }).then(function (res) {
      clearTimeout(timer);
      var copy = res && res.status === 200 ? res.clone() : null;
      settle(res);
      return copy ? put(req, copy) : null;
    }).catch(function () {
      clearTimeout(timer);
      return fallback().then(function (r) {
        settle(r || new Response('Offline', { status: 503, statusText: 'Offline' }));
      });
    });
    /* keep the worker alive until the cache write has finished */
    e.waitUntil(work);
  });
}

function staleWhileRevalidate(e) {
  var req = e.request;
  return caches.match(req, { ignoreSearch: true }).then(function (hit) {
    var net = fetch(req);
    var work = net.then(function (res) { return put(req, res.clone()); }).catch(function () {});
    e.waitUntil(work);
    return hit || net.catch(function () { return new Response('', { status: 504, statusText: 'Offline' }); });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  if (req.headers.has('range')) return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') e.respondWith(networkFirst(e));
  else e.respondWith(staleWhileRevalidate(e));
});
