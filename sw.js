 sw.js - Service Worker for RBI Quality PWA v16.0

const CACHE_NAME = 'rbi-quality-v16.0';
 Список файлов, которые необходимо кэшировать для работы офлайн
const urlsToCache = [
  '',
  'index.html',
  'cssstyle.css',
  'jsapp.js',
  'jsmath.js',
  'jsstorage.js',
  'jstemplates.js',
  'manifest.webmanifest',
  'httpscdn.tailwindcss.com',
  'httpscdn.jsdelivr.netnpmchart.js',
  'httpsfonts.googleapis.comcss2family=Interwght@400;600;700;800;900&display=swap'
];

 Устанавливаем сервис-воркер и кэшируем файлы
self.addEventListener('install', event = {
  console.log('[SW] Установка');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache = {
        console.log('[SW] Кэширование файлов');
        return cache.addAll(urlsToCache);
      })
      .then(() = self.skipWaiting())
  );
});

 Активация удаляем старые, ненужные кэши
self.addEventListener('activate', event = {
  console.log('[SW] Активация');
  event.waitUntil(
    caches.keys().then(cacheNames = {
      return Promise.all(
        cacheNames.map(cache = {
          if (cache !== CACHE_NAME) {
            console.log('[SW] Удаление старого кэша', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() = self.clients.claim())
  );
});

 Перехват fetch-запросов стратегия сначала кэш, потом сеть
self.addEventListener('fetch', event = {
  event.respondWith(
    caches.match(event.request)
      .then(response = {
         Если файл есть в кэше, возвращаем его
        if (response) {
          return response;
        }
         Иначе делаем запрос в сеть
        return fetch(event.request).then(
          response = {
             Проверяем, что получили валидный ответ
            if (!response  response.status !== 200  response.type !== 'basic') {
              return response;
            }
             Клонируем ответ, так как он может быть использован только раз
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then(cache = {
                cache.put(event.request, responseToCache);
              });
            return response;
          }
        );
      })
  );
});