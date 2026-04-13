/* Файл: sw.js */
// ОБЯЗАТЕЛЬНО МЕНЯЕМ ВЕРСИЮ, чтобы браузер понял, что вышел новый код!
const CACHE_NAME = 'rbi-quality-v16.2.2'; 

// Оставляем ЗДЕСЬ ТОЛЬКО ЛОКАЛЬНЫЕ ФАЙЛЫ (чтобы установка SW никогда не падала)
const urlsToCache = [
  './',
  './index.html',
  './css/style.css',
  './js/storage.js',
  './js/templates.js',
  './js/math.js',
  './js/app.js',
  './manifest.webmanifest'
];

// 1. УСТАНОВКА: Скачиваем локальные файлы в память
self.addEventListener('install', event => {
  self.skipWaiting(); // ЗАСТАВЛЯЕМ новый SW примениться немедленно (не ждать закрытия вкладок)
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Кэшируем ядро приложения...');
      return cache.addAll(urlsToCache);
    })
  );
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
  self.clients.claim(); // Немедленно перехватываем контроль над всеми открытыми страницами
});

// 3. ПЕРЕХВАТ ЗАПРОСОВ: Stale-While-Revalidate (Устаревшее, пока обновляется)
self.addEventListener('fetch', event => {
  // Игнорируем запросы, которые не относятся к HTTP/HTTPS (например, chrome-extension://)
  if (!event.request.url.startsWith('http')) return;
  // Игнорируем всё, кроме GET запросов
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      
      // Фоновый запрос в сеть за свежей версией
      const fetchPromise = fetch(event.request).then(networkResponse => {
        // Если ответ ок (или это непрозрачный ответ от CDN типа Tailwind) — кэшируем его "на лету"
        if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(err => {
        console.log('[SW] Офлайн режим. Сеть недоступна.', err);
      });

      // СНАЧАЛА отдаем кэш (если он есть). А в фоне уже пошел fetchPromise обновлять файлы.
      // Если кэша нет (например, впервые грузим Tailwind) — ждем fetchPromise.
      return cachedResponse || fetchPromise;
    })
  );
});
