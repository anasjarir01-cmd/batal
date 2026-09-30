/// <reference lib="webworker" />
// Service Worker: غلاف التطبيق مخزن مسبقًا (precache)، وأصول اللعب تُقدَّم من كاش مستقل
// يملؤه التنزيل الصريح من الإعدادات. تحديث الكاش لا يمس IndexedDB.
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

export const GAME_ASSET_CACHE = 'kb-game-assets-v1';

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

const GAME_ASSET_RE = /\/assets(?:-display)?\/[^?#]+\.(?:png|webp)$/;

self.addEventListener('fetch', (event: FetchEvent) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !GAME_ASSET_RE.test(url.pathname)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(GAME_ASSET_CACHE);
      const hit = await cache.match(url.href, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.status === 200) await cache.put(url.href, res.clone());
      return res;
    })(),
  );
});

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});
