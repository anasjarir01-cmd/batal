// تنزيل أصول اللعب إلى Cache Storage مع تقدم واضح واستئناف بعد انقطاع الشبكة.
// لا يُعلن «جاهز بلا إنترنت» إلا بعد وجود كل الأصول (نسخ العرض + الأصول PNG) في الكاش.
import { ASSETS } from '../catalog';

export const GAME_ASSET_CACHE = 'kb-game-assets-v1';

export interface AssetItem {
  url: string;
  bytes: number;
  sha256?: string;
}

export function assetItems(): AssetItem[] {
  const items: AssetItem[] = [];
  for (const a of ASSETS) {
    items.push({ url: a.display, bytes: a.displayBytes });
    items.push({ url: a.original, bytes: a.originalBytes, sha256: a.sha256 });
  }
  return items;
}

const abs = (u: string) => new URL(u, document.baseURI).href;

export interface AssetStatus {
  supported: boolean;
  total: number;
  cached: number;
  bytesTotal: number;
  bytesCached: number;
  ready: boolean;
}

export async function assetStatus(): Promise<AssetStatus> {
  const items = assetItems();
  const bytesTotal = items.reduce((s, i) => s + i.bytes, 0);
  if (typeof caches === 'undefined') return { supported: false, total: items.length, cached: 0, bytesTotal, bytesCached: 0, ready: false };
  const cache = await caches.open(GAME_ASSET_CACHE);
  const keys = new Set((await cache.keys()).map((r) => r.url));
  let cached = 0;
  let bytesCached = 0;
  for (const i of items) {
    if (keys.has(abs(i.url))) {
      cached++;
      bytesCached += i.bytes;
    }
  }
  return { supported: true, total: items.length, cached, bytesTotal, bytesCached, ready: cached === items.length };
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface DownloadProgress {
  done: number;
  total: number;
  bytesDone: number;
  bytesTotal: number;
}

export class AssetDownloadError extends Error {
  constructor(message: string, public offline: boolean) {
    super(message);
  }
}

/** ينزل ما ينقص فقط؛ يمكن إعادة تشغيله بعد انقطاع الشبكة. */
export async function downloadAssets(onProgress: (p: DownloadProgress) => void, signal?: AbortSignal): Promise<void> {
  if (typeof caches === 'undefined') throw new AssetDownloadError('هذا المتصفح لا يدعم التخزين للعمل دون إنترنت', false);
  const cache = await caches.open(GAME_ASSET_CACHE);
  const items = assetItems();
  const keys = new Set((await cache.keys()).map((r) => r.url));
  const total = items.length;
  const bytesTotal = items.reduce((s, i) => s + i.bytes, 0);
  let done = 0;
  let bytesDone = 0;
  const todo: AssetItem[] = [];
  for (const i of items) {
    if (keys.has(abs(i.url))) {
      done++;
      bytesDone += i.bytes;
    } else todo.push(i);
  }
  onProgress({ done, total, bytesDone, bytesTotal });
  let failure: AssetDownloadError | null = null;
  const worker = async () => {
    while (todo.length && !failure) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      const item = todo.shift() as AssetItem;
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(abs(item.url), { cache: 'no-cache', signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = await res.arrayBuffer();
          if (buf.byteLength !== item.bytes) throw new Error('حجم غير مطابق');
          if (item.sha256 && (await sha256Hex(buf)) !== item.sha256) throw new Error('بصمة غير مطابقة');
          const type = item.url.endsWith('.webp') ? 'image/webp' : 'image/png';
          await cache.put(abs(item.url), new Response(buf, { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(buf.byteLength) } }));
          lastErr = null;
          break;
        } catch (e) {
          if (signal?.aborted) throw e;
          lastErr = e;
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        }
      }
      if (lastErr) {
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        failure = new AssetDownloadError(offline ? 'انقطع الاتصال بالإنترنت. أعد المحاولة عند رجوع الشبكة وسيكمل التنزيل من حيث توقف.' : 'تعذر تنزيل بعض الصور. أعد المحاولة.', offline);
        todo.unshift(item);
        break;
      }
      done++;
      bytesDone += item.bytes;
      onProgress({ done, total, bytesDone, bytesTotal });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (failure) throw failure;
}
