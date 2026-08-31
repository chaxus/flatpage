/**
 * Service Worker —— 缓存策略来自 ranuts/sw，这里只决定「哪条路走哪种策略」。
 *
 * 页面（导航）走 network-first：cache-first 会让部署过的新版本推不到已经访问过
 * 的用户手上，他们要刷新两次才看得到。HTML 只有几 KB，多一次请求换「打开就是
 * 最新」值得；离线时照样回缓存。
 *
 * 其余是带内容指纹的静态资源和 wasm，内容一变文件名就变，cache-first 安全。
 * wasm 有 1.8MB，不进 install 的 precache —— 等第一次真正用到再缓存，
 * 首访代价保持不变。
 *
 * precache 清单放在 precache.json 里而不是内联：这份文件要被真正打包（才能
 * import ranuts/sw），而清单要等打包完成、文件名带上指纹之后才知道。
 */
/// <reference lib="webworker" />
import { precache, dropCachesExcept, networkFirst, cacheFirst } from 'ranuts/sw';

declare const self: ServiceWorkerGlobalScope;
declare const __BASE__: string;

const BASE = __BASE__;

interface Manifest {
  cache: string;
  shell: string[];
}

const manifest = async (): Promise<Manifest> => {
  const res = await fetch(`${BASE}precache.json`, { cache: 'no-store' });
  return (await res.json()) as Manifest;
};

self.addEventListener('install', (e: ExtendableEvent) => {
  e.waitUntil(
    manifest()
      .then((m) => precache(m.cache, m.shell))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e: ExtendableEvent) => {
  e.waitUntil(
    manifest()
      .then((m) => dropCachesExcept([m.cache]))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e: FetchEvent) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      (async (): Promise<Response> => {
        const m = await manifest().catch(() => null);
        const cacheName = m?.cache ?? 'flatpage';
        const res = await networkFirst(req, { cacheName });
        if (res.status !== 408) return res;
        // 离线，且这个 URL 从没缓存过（带 query 的链接等）：退回首页壳，
        // 总比一个 408 白屏好。
        const shell = await caches.match(BASE, { ignoreSearch: true });
        return shell ?? res;
      })(),
    );
    return;
  }

  if (url.pathname.endsWith('.wasm') || url.pathname.startsWith(`${BASE}assets/`)) {
    e.respondWith(
      (async (): Promise<Response> => {
        const m = await manifest().catch(() => null);
        return cacheFirst(req, { cacheName: m?.cache ?? 'flatpage' });
      })(),
    );
  }
});
