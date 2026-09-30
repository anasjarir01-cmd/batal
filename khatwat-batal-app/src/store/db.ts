// فتح IndexedDB وإنشاء المخازن والمهاجرات. المهاجرات تحافظ على بيانات المستخدم ولا تعيد seed البداية.
import { openDB, type IDBPDatabase } from 'idb';

export const DB_NAME = 'khatwat-batal';
/** نسخة بنية المخازن في IndexedDB. */
export const DB_VERSION = 1;
/** نسخة مخطط البيانات (المهاجرات المنطقية). */
export const SCHEMA_VERSION = 1;

export const STORES = [
  'meta',
  'profile',
  'heroes',
  'bosses',
  'entitlements',
  'challenges',
  'completions',
  'rewards',
  'purchases',
  'ledger',
  'blobs',
  'tracks',
  'battle',
  'notices',
] as const;
export type StoreName = (typeof STORES)[number];

const KEY_PATHS: Record<StoreName, string> = {
  meta: 'key',
  profile: 'id',
  heroes: 'heroId',
  bosses: 'bossId',
  entitlements: 'key',
  challenges: 'id',
  completions: 'key',
  rewards: 'id',
  purchases: 'id',
  ledger: 'id',
  blobs: 'id',
  tracks: 'id',
  battle: 'id',
  notices: 'id',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DB = IDBPDatabase<any>;

export async function openAppDb(name: string = DB_NAME): Promise<DB> {
  const db = await openDB(name, DB_VERSION, {
    upgrade(database, oldVersion, _newVersion, tx) {
      // v0 → v1: إنشاء كل المخازن
      if (oldVersion < 1) {
        for (const s of STORES) {
          if (!database.objectStoreNames.contains(s)) database.createObjectStore(s, { keyPath: KEY_PATHS[s] });
        }
        tx.objectStore('completions').createIndex('byChallenge', 'challengeId');
        tx.objectStore('completions').createIndex('byDate', 'dateKey');
        tx.objectStore('completions').createIndex('byKind', 'kind');
        tx.objectStore('purchases').createIndex('byReward', 'rewardId');
        tx.objectStore('ledger').createIndex('byAt', 'at');
        tx.objectStore('ledger').createIndex('byType', 'type');
      }
      // إصدارات لاحقة تضيف هنا تغييرات بنيوية دون حذف مخازن المستخدم.
    },
    blocking() {
      // لسان آخر يطلب ترقية: أغلق لتسمح بها، ثم يُعاد التحميل.
      db.close();
      if (typeof window !== 'undefined') window.location.reload();
    },
  });
  return db;
}

/** مهاجرات البيانات المنطقية حسب meta.schemaVersion. كل خطوة ذرية وتحافظ على المحتوى. */
export const DATA_MIGRATIONS: Array<{ to: number; run: (db: DB) => Promise<void> }> = [
  // مثال للإصدارات المقبلة:
  // { to: 2, run: async (db) => { const tx = db.transaction(['challenges','meta'],'readwrite'); ... } },
];

export async function runDataMigrations(db: DB): Promise<number> {
  const meta = await db.get('meta', 'schemaVersion');
  let current: number = meta?.value ?? 0;
  if (current === 0) return 0; // لم تُهيأ بعد
  for (const m of DATA_MIGRATIONS) {
    if (m.to > current) {
      await m.run(db);
      await db.put('meta', { key: 'schemaVersion', value: m.to });
      current = m.to;
    }
  }
  return current;
}

export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    if (!e) return null;
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    return null;
  }
}
