// pi-web's worker deliberately treats the live application as network-owned.
// It may cache only immutable build assets, install metadata/icons, and the
// generic offline document. No API, HTML shell, session, SSE, push, sound, or
// pairing response is ever written to Cache Storage.
const STATIC_CACHE = '__PI_WEB_STATIC_CACHE__';
const STATIC_CACHE_PREFIX = 'pi-web-static-';
const OFFLINE_DOCUMENT = '/offline.html';
const STATIC_PREFIXES = ['/static/desktop/assets/', '/static/mobile/assets/'];
const STATIC_PATHS = new Set([
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-maskable.svg',
  '/pi-logo.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
]);
const DYNAMIC_PREFIXES = ['/api/', '/session', '/events', '/sounds/', '/push/', '/pairing', '/device'];
const STATIC_MIME_TYPES = new Set([
  'application/javascript',
  'application/wasm',
  'font/otf',
  'font/ttf',
  'font/woff',
  'font/woff2',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'image/webp',
  'text/css',
  'text/javascript',
]);

function sameOrigin(url) {
  return url.origin === self.location.origin;
}

function startsWithPath(pathname, prefixes) {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

function isDynamicPath(pathname) {
  return startsWithPath(pathname, DYNAMIC_PREFIXES);
}

function isStaticPath(pathname) {
  if (isDynamicPath(pathname)) return false;
  return STATIC_PATHS.has(pathname) || startsWithPath(pathname, STATIC_PREFIXES);
}

function responseMime(response) {
  return (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
}

function sessionClientMatches(client, sessionId) {
  try {
    const url = new URL(client.url);
    return url.origin === self.location.origin && url.pathname === '/session' && url.searchParams.get('id') === sessionId;
  } catch (_) {
    return false;
  }
}

function isCacheableStaticResponse(response) {
  if (response.status !== 200 || response.redirected || response.type !== 'basic') return false;
  return STATIC_MIME_TYPES.has(responseMime(response));
}

function isCacheableOfflineResponse(response) {
  return response.status === 200 && !response.redirected && response.type === 'basic' && responseMime(response) === 'text/html';
}

async function cacheOfflineDocument() {
  try {
    const response = await fetch(new Request(OFFLINE_DOCUMENT, { cache: 'no-store' }));
    if (!isCacheableOfflineResponse(response)) return;
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(OFFLINE_DOCUMENT, response);
  } catch (_) {
    // Installation must still succeed if the host is temporarily unavailable.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      await self.skipWaiting();
      await cacheOfflineDocument();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((name) => name.startsWith(STATIC_CACHE_PREFIX) && name !== STATIC_CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

async function networkNavigation(request) {
  try {
    // Never satisfy a navigation from an HTTP/browser cache. The response may
    // contain the root shell or a session bootstrap tied to another user.
    return await fetch(new Request(request, { cache: 'no-store' }));
  } catch (_) {
    const cached = await caches.match(OFFLINE_DOCUMENT);
    return cached || new Response('Pi Sessions is unavailable. Reconnect to pi-web.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function networkStaticAsset(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  // A cache-version bump must refresh unversioned icons as well as hashed assets.
  const response = await fetch(new Request(request, { cache: 'reload' }));
  if (isCacheableStaticResponse(response)) {
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!sameOrigin(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkNavigation(request));
    return;
  }

  // This allowlist is intentionally narrower than the origin. In particular,
  // no API, session, root HTML, SSE, push, sound, pairing, or device request
  // can reach Cache Storage, even if its response happens to look cacheable.
  if (!isStaticPath(url.pathname)) return;
  event.respondWith(networkStaticAsset(request));
});

// Web Push is notification delivery, not a data cache. Payload text is used
// only for the system notification and is never written to Cache Storage.
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let data = {};
    try {
      data = event.data ? event.data.json() : {};
    } catch (_) {
      data = { title: 'Pi Sessions', body: 'Response ready' };
    }

    const isSchedule = data.type === 'schedule-done';
    if (!isSchedule && data.sessionId) {
      const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const hasForegroundTarget = clientsList.some(
        (client) =>
          (client.visibilityState === 'visible' || client.focused === true) &&
          sessionClientMatches(client, data.sessionId),
      );
      if (hasForegroundTarget) return;
    }

    const title = data.title || 'Pi Sessions';
    await self.registration.showNotification(title, {
      body: data.body || 'Response ready',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: isSchedule ? `pi-schedule-${data.sessionId || ''}` : 'pi-session-done',
      renotify: true,
      data: { sessionId: data.sessionId || '' },
      silent: false,
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const sessionId = event.notification.data && event.notification.data.sessionId;
  const target = sessionId ? `/session?id=${encodeURIComponent(sessionId)}` : '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      const matches = sessionId
        ? sessionClientMatches(client, sessionId)
        : (() => {
            try {
              const url = new URL(client.url);
              return url.origin === self.location.origin && url.pathname === '/';
            } catch (_) {
              return false;
            }
          })();
      if (matches && 'focus' in client) return client.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});
