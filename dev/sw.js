/* 회화 영어 단어장 · 6,412 SRS — service worker (GitHub Pages)
 * - index.html(문서)과 data/*.js: network-first(+ETag 재검증) → 배포하면 다음 실행에 바로 최신본,
 *   바뀐 게 없으면 304 라 데이터도 거의 안 받는다
 * - css·아이콘 등 정적 자산: cache-first + 백그라운드 갱신 (오프라인에서도 즉시)
 * - VERSION 을 올리면 이전 버전 캐시는 activate 에서 전부 삭제
 */
var VERSION = 'v4.0.2-gh';
var CORE = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.json',
  'data/lv1.js',
  'data/lv2.js',
  'data/lv3.js',
  'data/lv4.js',
  'data/lv5.js',
  'data/lv6.js',
  'data/meta.js',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
  'favicon-32.png',
  'favicon-192.png'
];
/* 네트워크가 이 시간 안에 응답하지 않으면 캐시로 먼저 띄운다 */
var NET_TIMEOUT = 4000;

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSION).then(function (c) {
      return Promise.all(CORE.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* 문서·데이터처럼 자주 바뀌는 것: 네트워크 우선, 실패/지연 시 캐시 */
function networkFirst(req, fallbackKey) {
  return new Promise(function (resolve) {
    var settled = false;
    var timer = setTimeout(function () {
      caches.match(fallbackKey, { ignoreSearch: true }).then(function (hit) {
        if (hit && !settled) { settled = true; resolve(hit); }
      }).catch(function () {});
    }, NET_TIMEOUT);

    fetch(new Request(req, { cache: 'no-cache' })).then(function (res) {
      clearTimeout(timer);
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put(fallbackKey, copy); }).catch(function () {});
      }
      if (!settled) { settled = true; resolve(res); }
    }).catch(function () {
      clearTimeout(timer);
      caches.match(fallbackKey, { ignoreSearch: true }).then(function (hit) {
        if (settled) return;
        if (hit) { settled = true; resolve(hit); }
        else { settled = true; resolve(fetch(req, { cache: 'reload' })); }
      }).catch(function () { settled = true; resolve(Response.error()); });
    });
  });
}

/* css·아이콘: 캐시 우선 + 백그라운드 갱신 */
function cacheFirst(req, key) {
  return caches.match(key, { ignoreSearch: true }).then(function (hit) {
    if (hit) {
      fetch(req).then(function (res) {
        if (res && res.ok) caches.open(VERSION).then(function (c) { c.put(key, res.clone()); });
      }).catch(function () {});
      return hit;
    }
    return fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put(key, copy); });
      }
      return res;
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || req.url.indexOf('http') !== 0) return;
  if (new URL(req.url).origin !== location.origin) return;

  var path = new URL(req.url).pathname;

  if (req.mode === 'navigate' || /\/$|\.html$/.test(path)) {
    /* 폴백 키는 그 페이지 자신 — 예전에는 모든 .html 이 'index.html' 키를 덮어써서
       QA·촬영 페이지를 한 번 열면 앱 껍데기 캐시가 그 페이지로 바뀌었다 */
    var navKey = /\/$/.test(path) || /\/index\.html$/.test(path) ? 'index.html' : path;
    e.respondWith(networkFirst(req, navKey));
    return;
  }
  /* 문서와 같은 세대여야 하는 app.js·styles.css 도 네트워크 우선 — 새 index.html + 예전 app.js 로
     화면이 어긋나는 것을 막는다 (둘 다 작아서 비용이 경미) */
  if (/\/data\/[^/]+\.js$/.test(path) || /\.json$/.test(path) || /\/sw\.js$/.test(path) ||
      /\/(app|styles)\.(js|css)$/.test(path)) {
    e.respondWith(networkFirst(req, req));
    return;
  }
  e.respondWith(cacheFirst(req, req));
});
