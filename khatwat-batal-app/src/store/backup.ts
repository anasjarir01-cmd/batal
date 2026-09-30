// النسخ الاحتياطي: ملف ZIP بملفات ثنائية فعلية للصور والموسيقى + بيانات JSON + manifest.
// الاستيراد يفحص كل شيء قبل أي تغيير، ثم يستبدل البيانات في معاملة واحدة (فشلها لا يغير شيئًا).
import { unzipSync, zipSync, strToU8, strFromU8, type Zippable } from 'fflate';
import { CATALOG } from '../catalog';
import { SCHEMA_VERSION, STORES, runDataMigrations, type DB, type StoreName } from './db';
import { OpError, uid, withTx } from './ops';
import type { StoredBlob } from './types';

export const BACKUP_FORMAT = 'khatwat-batal-backup';
export const BACKUP_FORMAT_VERSION = 1;

interface MediaEntry {
  id: string;
  path: string;
  type: string;
  name: string;
  size: number;
  sha256: string;
  purpose: StoredBlob['purpose'];
  createdAt: number;
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  schemaVersion: number;
  appVersion: string;
  exportedAt: number;
  counts: Record<string, number>;
  media: MediaEntry[];
}

const DATA_STORES = STORES.filter((s) => s !== 'blobs');

async function sha256Hex(data: Uint8Array | ArrayBuffer): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', data as BufferSource);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function extFor(type: string, name: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name);
  if (m) return m[1].toLowerCase();
  if (type.includes('png')) return 'png';
  if (type.includes('jpeg')) return 'jpg';
  if (type.includes('webp')) return 'webp';
  if (type.includes('mpeg')) return 'mp3';
  return 'bin';
}

export async function exportBackup(db: DB, appVersion = '1.0.0', now = Date.now()): Promise<{ bytes: Uint8Array; filename: string; manifest: BackupManifest }> {
  // قراءة متسقة لكل المخازن في معاملة قراءة واحدة
  const tx = db.transaction([...STORES], 'readonly');
  const all = await Promise.all(STORES.map((s) => tx.objectStore(s).getAll()));
  await tx.done;
  const byStore = Object.fromEntries(STORES.map((s, i) => [s, all[i]])) as Record<StoreName, unknown[]>;
  const files: Zippable = {};
  const media: MediaEntry[] = [];
  for (const b of byStore.blobs as StoredBlob[]) {
    const bytes = new Uint8Array(b.data);
    const path = `media/${b.id}.${extFor(b.type, b.name)}`;
    files[path] = [bytes, { level: 0 }];
    media.push({ id: b.id, path, type: b.type, name: b.name, size: bytes.byteLength, sha256: await sha256Hex(bytes), purpose: b.purpose, createdAt: b.createdAt });
  }
  const data: Record<string, unknown[]> = {};
  for (const s of DATA_STORES) data[s] = byStore[s];
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    appVersion,
    exportedAt: now,
    counts: Object.fromEntries(STORES.map((s) => [s, byStore[s].length])),
    media,
  };
  files['manifest.json'] = [strToU8(JSON.stringify(manifest, null, 2)), { level: 6 }];
  files['data.json'] = [strToU8(JSON.stringify(data)), { level: 6 }];
  const bytes = zipSync(files);
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  const filename = `khatwat-batal-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.zip`;
  return { bytes, filename, manifest };
}

export interface ParsedBackup {
  manifest: BackupManifest;
  data: Record<string, unknown[]>;
  blobs: StoredBlob[];
}

const bad = (m: string): never => {
  throw new OpError('invalid', `ملف النسخة غير صالح: ${m}`);
};
const isInt = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const isStr = (s: unknown) => typeof s === 'string';

/** يفحص الصيغة والروابط والبيانات دون لمس قاعدة البيانات. */
export async function parseBackup(input: ArrayBuffer | Uint8Array): Promise<ParsedBackup> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(input instanceof Uint8Array ? input : new Uint8Array(input));
  } catch {
    return bad('ليس ملف ZIP سليمًا');
  }
  if (!entries['manifest.json'] || !entries['data.json']) bad('manifest.json أو data.json مفقود');
  let manifest: BackupManifest;
  let data: Record<string, unknown[]>;
  try {
    manifest = JSON.parse(strFromU8(entries['manifest.json']));
    data = JSON.parse(strFromU8(entries['data.json']));
  } catch {
    return bad('JSON تالف');
  }
  if (manifest.format !== BACKUP_FORMAT) bad('ليس نسخة من خطوة بطل');
  if (manifest.formatVersion !== BACKUP_FORMAT_VERSION) bad('إصدار صيغة غير مدعوم');
  if (!isInt(manifest.schemaVersion) || manifest.schemaVersion > SCHEMA_VERSION) bad('النسخة من إصدار أحدث من التطبيق؛ حدّث التطبيق أولًا');
  for (const s of DATA_STORES) if (!Array.isArray(data[s])) bad(`المخزن ${s} مفقود`);

  // الوسائط
  const blobs: StoredBlob[] = [];
  const mediaIds = new Set<string>();
  if (!Array.isArray(manifest.media)) bad('قائمة الوسائط مفقودة');
  for (const m of manifest.media) {
    const bytes = entries[m.path];
    if (!bytes) bad(`ملف وسائط مفقود ${m.path}`);
    if (bytes.byteLength !== m.size) bad(`حجم مختلف ${m.path}`);
    if ((await sha256Hex(bytes)) !== m.sha256) bad(`بصمة مختلفة ${m.path}`);
    if (mediaIds.has(m.id)) bad('وسائط مكررة');
    mediaIds.add(m.id);
    const copy = bytes.slice().buffer;
    blobs.push({ id: m.id, data: copy, type: m.type, name: m.name, size: m.size, purpose: m.purpose, createdAt: m.createdAt });
  }

  // الملف الشخصي والأرصدة
  const profiles = data.profile as Array<Record<string, unknown>>;
  if (profiles.length !== 1 || profiles[0].id !== 'main') bad('الملف الشخصي مفقود');
  const p = profiles[0];
  for (const k of ['xp', 'coins', 'gems', 'coinsEarned', 'coinsSpent', 'gemsEarned', 'gemsSpent']) if (!isInt(p[k])) bad(`قيمة غير صالحة ${k}`);
  if ((p.coins as number) !== (p.coinsEarned as number) - (p.coinsSpent as number)) bad('رصيد Coins غير متسق');
  if ((p.gems as number) !== (p.gemsEarned as number) - (p.gemsSpent as number)) bad('رصيد الجواهر غير متسق');

  // المفاتيح الفريدة
  const keyOf: Partial<Record<StoreName, string>> = { ledger: 'id', completions: 'key', purchases: 'id', challenges: 'id', rewards: 'id', tracks: 'id', heroes: 'heroId', bosses: 'bossId' };
  for (const [s, k] of Object.entries(keyOf)) {
    const arr = data[s] as Array<Record<string, unknown>>;
    const seen = new Set<unknown>();
    for (const r of arr) {
      if (!isStr(r[k as string])) bad(`سجل بلا مفتاح في ${s}`);
      if (seen.has(r[k as string])) bad(`مفتاح مكرر في ${s}`);
      seen.add(r[k as string]);
    }
  }
  // الروابط
  const challengeIds = new Set((data.challenges as Array<{ id: string }>).map((c) => c.id));
  const rewardIds = new Set((data.rewards as Array<{ id: string }>).map((c) => c.id));
  for (const c of data.challenges as Array<{ imageId: string | null; name: unknown }>) {
    if (!isStr(c.name)) bad('تحدٍّ بلا اسم');
    if (c.imageId && !mediaIds.has(c.imageId)) bad('صورة تحدٍّ مفقودة');
  }
  for (const r of data.rewards as Array<{ imageId: string | null; price: unknown }>) {
    if (!isInt(r.price)) bad('ثمن جائزة غير صالح');
    if (r.imageId && !mediaIds.has(r.imageId)) bad('صورة جائزة مفقودة');
  }
  for (const c of data.completions as Array<{ challengeId: string }>) if (!challengeIds.has(c.challengeId)) bad('إكمال لتحدٍّ غير موجود');
  for (const pu of data.purchases as Array<{ rewardId: string }>) if (!rewardIds.has(pu.rewardId)) bad('شراء لجائزة غير موجودة');
  for (const t of data.tracks as Array<{ blobId: string }>) if (!mediaIds.has(t.blobId)) bad('ملف أغنية مفقود');
  // المعركة المحفوظة
  const battle = (data.battle as Array<Record<string, unknown>>)[0] as { state?: { bossId: string; heroes: unknown[]; teamHeroIds: string[] } } | undefined;
  if (battle?.state) {
    const st = battle.state;
    if (!CATALOG.bossById.has(st.bossId)) bad('زعيم المعركة المحفوظة غير معروف');
    if (!Array.isArray(st.heroes) || st.heroes.length !== 5) bad('حالة معركة تالفة');
    for (const h of st.teamHeroIds) if (!CATALOG.heroById.has(h)) bad('بطل المعركة المحفوظة غير معروف');
  }
  return { manifest, data, blobs };
}

/** يستبدل كل البيانات بمحتوى النسخة في معاملة واحدة. لا يدمج سجلين. */
export async function importBackup(db: DB, parsed: ParsedBackup, now = Date.now()): Promise<void> {
  await withTx(db, [...STORES], async (tx) => {
    for (const s of STORES) await tx.objectStore(s).clear();
    for (const s of DATA_STORES) for (const rec of parsed.data[s]) await tx.objectStore(s).put(rec);
    for (const b of parsed.blobs) await tx.objectStore('blobs').put(b);
    await tx.objectStore('ledger').put({ id: uid('restore-'), type: 'backup-restore', at: now, data: { exportedAt: parsed.manifest.exportedAt } });
  });
  await runDataMigrations(db);
}
