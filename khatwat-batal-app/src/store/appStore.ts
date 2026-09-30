// حالة التطبيق في الذاكرة: تُقرأ من IndexedDB وتُحدّث بعد كل عملية، وتُبث للألسنة الأخرى.
import { useSyncExternalStore } from 'react';
import { msUntilNextLocalMidnight } from '../engine/dates';
import { openAppDb, requestPersistentStorage, runDataMigrations, type DB } from './db';
import { getBlob, initIfNeeded, loadAll, reconcileEntitlements, type AppData } from './ops';

let db: DB | null = null;
let data: AppData | null = null;
let bootError: string | null = null;
const listeners = new Set<() => void>();
let channel: BroadcastChannel | null = null;
let midnightTimer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  for (const l of listeners) l();
}

export function getDb(): DB {
  if (!db) throw new Error('قاعدة البيانات غير جاهزة');
  return db;
}

export async function refresh(): Promise<void> {
  if (!db) return;
  data = await loadAll(db);
  emit();
}

function scheduleMidnight() {
  if (midnightTimer) clearTimeout(midnightTimer);
  midnightTimer = setTimeout(() => {
    void refresh();
    scheduleMidnight();
  }, msUntilNextLocalMidnight());
}

export async function bootstrap(): Promise<void> {
  try {
    db = await openAppDb();
    await initIfNeeded(db);
    await runDataMigrations(db);
    await reconcileEntitlements(db);
    data = await loadAll(db);
    // طلب تخزين دائم إن دعمه المتصفح (لا يمنع العمل إن رُفض)
    void requestPersistentStorage();
  } catch (e) {
    bootError = e instanceof Error ? e.message : String(e);
  }
  emit();
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel('khatwat-batal');
    channel.onmessage = () => void refresh();
  }
  // إعادة تقييم اليوم عند الرجوع للتطبيق، حتى لو لم يعمل مؤقت منتصف الليل
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void refresh();
      scheduleMidnight();
    }
  });
  window.addEventListener('focus', () => void refresh());
  scheduleMidnight();
}

/** ينفذ عملية على قاعدة البيانات ثم يحدث الحالة ويبلغ الألسنة الأخرى. */
export async function act<T>(fn: (db: DB) => Promise<T>): Promise<T> {
  try {
    return await fn(getDb());
  } finally {
    await refresh();
    channel?.postMessage({ t: 'changed', at: Date.now() });
  }
}

export function useApp(): AppData | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => data,
  );
}

export function useBootError(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => bootError,
  );
}

// ——— روابط الوسائط المحلية (Blob URLs) ———
const blobUrls = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

export function blobUrlFor(id: string | null | undefined): Promise<string | null> {
  if (!id) return Promise.resolve(null);
  const cached = blobUrls.get(id);
  if (cached) return Promise.resolve(cached);
  const p = pending.get(id);
  if (p) return p;
  const job = (async () => {
    const b = await getBlob(getDb(), id);
    if (!b) return null;
    const url = URL.createObjectURL(new Blob([b.data], { type: b.type }));
    blobUrls.set(id, url);
    return url;
  })().finally(() => pending.delete(id));
  pending.set(id, job);
  return job;
}

export function cachedBlobUrl(id: string | null | undefined): string | null {
  return id ? (blobUrls.get(id) ?? null) : null;
}
