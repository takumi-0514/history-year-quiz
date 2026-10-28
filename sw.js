// Clean ServiceWorker script: purge caches and unregister safely
self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(cacheNames.map((name) => caches.delete(name)));
        }).then(() => {
            return self.registration.unregister();
        }).then(() => {
            return self.clients.claim();
        })
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(fetch(event.request));
});

