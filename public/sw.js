const CACHE = 'lucky-shell-v1';
const SHELL = ['/offline.html', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('lucky-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  // Never cache recordings, credentials, API responses, or authenticated pages.
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
  else if (SHELL.includes(new URL(event.request.url).pathname)) event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request)));
});
