const CACHE_NAME = 'rbi-quality-v16.22.0';

// Добавили внешние библиотеки, чтобы приложение было на 100% автономным при первом же запуске
const urlsToCache = [
  './',
  './index.html',
  './css/style.css',
  './js/storage.js',
  './js/templates.js',
  './js/math.js',
  './js/app.js',
  './manifest.webmanifest',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
];

// 1. УСТАНОВКА: Скачиваем все файлы в память
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Кэшируем ядро приложения...');
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting(); // Заставляем SW примениться немедленно
});

// 2. АКТИВАЦИЯ: Жестко удаляем старые версии кэша
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Удаляем старый кэш:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim(); // Немедленно берем контроль над открытыми страницами
});

// 3. ПЕРЕХВАТ ЗАПРОСОВ: Стратегия "Stale-While-Revalidate" (Сначала кэш, но тихо обновляем в фоне)
self.addEventListener('fetch', event => {
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      
      // Независимо от того, нашли мы файл в кэше или нет, мы делаем запрос в сеть (в фоне)
      const fetchPromise = fetch(event.request).then(networkResponse => {
        // Проверяем, что ответ нормальный (или это непрозрачный ответ от CDN, типа Tailwind)
        if (!networkResponse || (networkResponse.status !== 200 && networkResponse.type !== 'opaque')) {
          return networkResponse;
        }
        
        // Клонируем свежий ответ и кладем его в кэш (тихо обновляем старый)
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseToCache);
        });
        
        return networkResponse;
      }).catch(() => {
        console.log('[SW] Офлайн режим: мы без интернета, используем только кэш.');
      });

      // Если файл есть в кэше — отдаем его МГНОВЕННО (пользователь не ждет сеть).
      // Если файла в кэше нет — ждем ответа от сети (fetchPromise).
      return cachedResponse || fetchPromise;
    })
  );
});
