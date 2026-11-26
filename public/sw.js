const CACHE_NAME = 'raritetbook-pwa-v9';

// Список всех JS/CSS/мета-файлов оболочки инжектируется автоматически при сборке postbuild-скриптом!
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/school',
  '/favicon.svg',
  '/manifest.webmanifest',
  '/archive-meta/categories.json',
  '/archive-meta/home-featured.json',
  '/archive-meta/school-curriculum.json',
  '/archive-meta/manifest.json',
  '/archive-meta/hero-preview.json',
  '/archive-meta/shards/idx-0.json',
  /*__PRECACHE_ASSETS__*/
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(async (cache) => {
        // Кэшируем каждый ассет индивидуально, чтобы сбой одного второстепенного файла не сорвал установку всего PWA
        await Promise.allSettled(
          SHELL_ASSETS.map((assetUrl) =>
            fetch(assetUrl, { cache: 'no-cache' }).then((resp) => {
              if (resp.ok) return cache.put(assetUrl, resp);
            })
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Никогда не кэшируем облачный API авторизации и синхронизации
  if (url.hostname === 'api.raritetbook.ru' || url.pathname.startsWith('/api/')) {
    return;
  }

  // 1. HTML-навигация (переходы Назад/Вперёд, перезагрузка /book/*, /read/*, /catalog в авиарежиме!)
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const networkResp = await fetch(request);
          if (networkResp.ok) {
            cache.put('/index.html', networkResp.clone()).catch(() => {});
            return networkResp;
          }
          // Если статический хостинг вернул 404 для SPA-маршрута — отдаём её же или кэшированный shell
          if (networkResp.status === 404) {
            const shell = (await cache.match('/index.html')) || (await cache.match('/'));
            return shell || networkResp;
          }
          return networkResp;
        } catch {
          const shell =
            (await cache.match(request, { ignoreSearch: true })) ||
            (await cache.match('/index.html')) ||
            (await cache.match('/'));
          if (shell) return shell;
          return new Response(
            '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Офлайн — RaritetBook.ru</title><body style="background:#171513;color:#F1E6D3;font-family:Georgia,serif;padding:32px;text-align:center"><h1>Авиарежим</h1><p>Откройте главную страницу с интернетом один раз для сохранения оболочки библиотеки.</p></body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        }
      })()
    );
    return;
  }

  // 2. Локальная статика (/assets/*, /archive-meta/*, иконки, картинки) + шрифты + JSON книг из CDN
  const isSameOriginAsset =
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/assets/') ||
      url.pathname.startsWith('/archive-meta/') ||
      url.pathname === '/favicon.svg' ||
      url.pathname === '/manifest.webmanifest');

  const isBookCdnOrFont =
    url.hostname === 'raw.githubusercontent.com' ||
    url.hostname === 'archive.raritetbook.ru' ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com';

  if (isSameOriginAsset || isBookCdnOrFont) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request);
        if (cached) {
          // Stale-while-revalidate в фоне без блокировки авиарежима
          fetch(request)
            .then((resp) => {
              if (resp && resp.ok) cache.put(request, resp.clone()).catch(() => {});
            })
            .catch(() => {});
          return cached;
        }

        try {
          const resp = await fetch(request);
          if (resp && resp.ok) {
            cache.put(request, resp.clone()).catch(() => {});
          }
          return resp;
        } catch {
          // Гарантируем валидный Response вместо undefined, чтобы браузер никогда не падал с ERR_FAILED!
          return new Response('{"offline":true}', {
            status: 503,
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
          });
        }
      })()
    );
  }
});
