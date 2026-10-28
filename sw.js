/* Asia 2026 · service worker · V58
   - La app (HTML, iconos, foto local) se guarda al instalar y funciona sin conexión.
   - Fotos externas (Unsplash, Wikimedia): se guardan al verlas y se reutilizan offline.
   - Cambio de moneda y API de Wikimedia: red primero, y si no hay conexión, lo último guardado. */
const VERSION='v10b';
const SHELL = 'asia26-shell-' + VERSION;
const IMGS = 'asia26-img-' + VERSION;
const DATA = 'asia26-data-' + VERSION;
const MAX_IMGS = 150;
const SHELL_FILES = ['./', 'index.html', 'v58-art.js', 'manifest.json', 'icon-180.png', 'koh-tao-sairee.jpg'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // allSettled: si falta algún archivo opcional, la instalación no falla
    await Promise.allSettled(SHELL_FILES.map(f => cache.add(f)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = [SHELL, IMGS, DATA];
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('asia26-') && !keep.includes(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map(k => cache.delete(k)));
}

// Sirve lo guardado al instante y actualiza en segundo plano
async function staleWhileRevalidate(req, cacheName, fallbackKey) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreSearch: false }) || (fallbackKey ? await cache.match(fallbackKey) : undefined);
  const net = fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(() => undefined);
  return hit || (await net) || Response.error();
}

// Red primero; si falla, lo último guardado
async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(req);
    return hit || Response.error();
  }
}

// Guardado primero; si no está, red y se guarda
async function cacheFirst(req, cacheName, max) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) {
      await cache.put(req, res.clone());
      trim(cacheName, max);
    }
    return res;
  } catch (e) {
    return Response.error();
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Páginas de la app
  if (req.mode === 'navigate') {
    event.respondWith(staleWhileRevalidate(req, SHELL, 'index.html'));
    return;
  }
  // Archivos propios
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, SHELL));
    return;
  }
  // Fotos externas
  if (req.destination === 'image' || /(^|\.)unsplash\.com$|(^|\.)wikimedia\.org$|(^|\.)wikipedia\.org$/.test(url.hostname) && /\.(jpe?g|png|webp|gif|svg)(\?|$)/i.test(url.pathname + url.search)) {
    event.respondWith(cacheFirst(req, IMGS, MAX_IMGS));
    return;
  }
  // Datos: cambio de moneda y búsqueda de fotos en Wikimedia
  if (url.hostname === 'open.er-api.com' || /wikimedia\.org$|wikipedia\.org$/.test(url.hostname)) {
    event.respondWith(networkFirst(req, DATA));
    return;
  }
  // Google Maps, enlaces externos, etc.: directo a la red
});
