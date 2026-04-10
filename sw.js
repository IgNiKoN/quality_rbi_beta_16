const CACHE_NAME = 'rbi-quality-cache-v16.1';

// Список файлов, которые нужно сохранить в память телефона для работы без интернета
const urlsToCache = [
  './',
  './index.html',
  './css/style.css',
  './js/storage.js',
  './js/templates.js',
  './js/math.js',
  './js/app.js',
  './manifest.webmanifest'
  // Если добавишь иконки, раскомментируй строки ниже:
  // './icons/icon-192.png',
  // './icons/icon-512.png'
];

// 1. Установка Service Worker и кэширование файлов
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Кэш открыт, загружаем файлы...');
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting();
});

// 2. Активация и удаление старых кэшей (если обновилась версия)
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Удаляем старый кэш:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 3. Перехват запросов (достаем из кэша, если нет интернета)
self.addEventListener('fetch', event => {
  // Пропускаем запросы к API или расширениям браузера (chrome-extension)
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Если файл есть в кэше — отдаем его
        if (response) {
          return response;
        }
        // Если файла нет в кэше — скачиваем из интернета
        return fetch(event.request).then(
          function(response) {
            // Проверяем, что ответ нормальный
            if(!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }
            
            // Динамически кэшируем новые ресурсы (например, скрипт Tailwind)
            var responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then(function(cache) {
                cache.put(event.request, responseToCache);
              });
            return response;
          }
        );
      })
  );
});
