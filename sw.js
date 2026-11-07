/* gaara. service worker: keeps the app available offline.
   - the page itself: network first (so updates arrive as soon as you are online), cached copy when offline or slow
   - icon and other same-origin files: cached copy straight away, refreshed in the background
   GitHub sync requests are on another origin and are never touched here. */
var CACHE = 'gaara-v2';
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

function networkFirst(req) {
  return new Promise(function (resolve) {
    var done = false;
    var fallback = function () {
      return caches.match(req, { ignoreSearch: true })
        .then(function (r) { return r || caches.match('index.html'); })
        .then(function (r) { return r || caches.match('./'); });
    };
    var timer = setTimeout(function () {
      fallback().then(function (r) { if (r && !done) { done = true; resolve(r); } });
    }, 3500);
    fetch(req).then(function (res) {
      clearTimeout(timer);
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      if (!done) { done = true; resolve(res); }
    }).catch(function () {
      clearTimeout(timer);
      fallback().then(function (r) {
        if (!done) { done = true; resolve(r || new Response('Offline', { status: 503, statusText: 'Offline' })); }
      });
    });
  });
}

function staleWhileRevalidate(req) {
  return caches.match(req, { ignoreSearch: true }).then(function (hit) {
    var net = fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () { return hit; });
    return hit || net;
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') e.respondWith(networkFirst(req));
  else e.respondWith(staleWhileRevalidate(req));
});
