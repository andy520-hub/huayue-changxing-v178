// 华越畅行 PWA Service Worker —— 仅缓存应用外壳，让主屏图标离线也能打开界面
// 注意：机翻接口(api.mymemory.translated.net)始终走网络，不缓存。
const CACHE = 'huayue-v1.7.8';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) {
        return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  // 翻译接口：直接走网络，不拦截
  if (url.hostname === 'api.mymemory.translated.net') return;
  // V1.7.6 / V1.7.7：汇率接口 / OCR 引擎与语言包一律走网络，不进 SW 缓存
  if (url.hostname === 'open.er-api.com' ||
      url.hostname === 'cdn.jsdelivr.net' ||
      url.hostname === 'tessdata.projectnaptha.com') return;
  // V1.7.8：腾讯云 OCR 代理走网络，不缓存（同源 /api/ocr）
  if (url.pathname.indexOf('/api/ocr') >= 0) return;
  if (e.request.method !== 'GET') return;

  // 页面导航：网络优先（保证一上线就拿到最新版），断网再回退缓存
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(function (resp) {
        if (resp && resp.ok) {
          var cp = resp.clone();
          caches.open(CACHE).then(function (c) { c.put('./index.html', cp); });
        }
        return resp;
      }).catch(function () { return caches.match('./index.html'); })
    );
    return;
  }

  // 静态资源：缓存优先
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      if (cached) return cached;
      return fetch(e.request).then(function (resp) {
        // 只缓存同源的静态资源
        if (resp && resp.ok && url.origin === self.location.origin) {
          var cp = resp.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, cp); });
        }
        return resp;
      }).catch(function () {
        if (e.request.mode === 'navigate') return caches.match('./index.html');
      });
    })
  );
});
