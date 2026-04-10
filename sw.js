const CACHE_NAME = 'rbi-quality-v16.0';

// ПРАВИЛЬНЫЕ пути для кэширования
const urlsToCache = [
  '/quality_rbi_beta_16/',
  '/quality_rbi_beta_16/index.html',
  '/quality_rbi_beta_16/css/style.css',
  '/quality_rbi_beta_16/js/app.js',
  '/quality_rbi_beta_16/js/math.js',
  '/quality_rbi_beta_16/js/storage.js',
  '/quality_rbi_beta_16/js/templates.js',
  '/quality_rbi_beta_16/manifest.webmanifest',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap'
];

// Устанавливаем сервис-воркер и кэшируем файлы
self.addEventListener('install', event => {
  console.log('[SW] Установка');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Кэширование файлов');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting())
  );
});

// Активация - удаляем старые кэши
self.addEventListener('activate', event => {
  console.log('[SW] Активация');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            console.log('[SW] Удаление старого кэша', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Перехват fetch-запросов - стратегия "сначала кэш, потом сеть"
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request).then(response => {
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          const responseToCache = response.clone();
          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put(event.request, responseToCache);
            });
          return response;
        });
      })
  );
});