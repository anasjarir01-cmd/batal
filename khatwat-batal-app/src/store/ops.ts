// العمليات الذرية على البيانات. كل عملية مالية أو تقدم أو ملكية تُنفذ في معاملة IndexedDB واحدة
// تقرأ الحالة وتتحقق منها ثم تكتب، فلا ازدواج عند النقر المتكرر أو إعادة التحميل أو تعدد الألسنة.
import type { IDBPTransaction } from 'idb';
import { CATALOG, rankCompletionRewards } from '../catalog';
import { assignSlots, createBattle, executeRound, retreat, rollBossCandidates } from '../engine/battle/engine';
import { battleWinners } from '../engine/battle/rewards';
import type { PlannedCard } from '../engine/battle/types';
import { localDateKey } from '../engine/dates';
import { canComplete, completionKey, cosmeticLevel, HERO_PRICE_GEMS, isValidRewardNumber, rewardFor } from '../engine/economy';
import { milestonesBetween } from '../engine/progression';
import { randomSeed } from '../engine/rng';
import { SCHEMA_VERSION, type DB, type StoreName } from './db';
import {
  DEFAULT_SETTINGS,
  type BattleRecord,
  type BossEntitlement,
  type Challenge,
  type Completion,
  type LedgerEntry,
  type Notice,
  type OwnedHero,
  type Profile,
  type Purchase,
  type Reward,
  type Settings,
  type StoredBlob,
  type Track,
  type UnlockedBoss,
} from './types';

export class OpError extends Error {
  constructor(
    public code:
      | 'not-found'
      | 'already-done'
      | 'insufficient'
      | 'owned'
      | 'invalid'
      | 'stale'
      | 'duplicate'
      | 'quota',
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function uid(prefix = ''): string {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return prefix + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = IDBPTransaction<any, StoreName[], 'readwrite'>;

function isQuotaError(e: unknown): boolean {
  return e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
}

export async function withTx<T>(db: DB, stores: StoreName[], fn: (tx: Tx) => Promise<T>): Promise<T> {
  const tx = db.transaction(stores, 'readwrite') as Tx;
  tx.done.catch(() => undefined);
  try {
    const result = await fn(tx);
    await tx.done;
    return result;
  } catch (e) {
    try {
      tx.abort();
    } catch {
      /* already finished */
    }
    if (isQuotaError(e) || (e instanceof DOMException && e.name === 'AbortError' && isQuotaError(tx.error))) {
      throw new OpError('quota', 'مساحة التخزين في الجهاز غير كافية؛ لم يُحفظ التغيير.');
    }
    throw e;
  }
}

const ledger = (tx: Tx, entry: LedgerEntry) => tx.objectStore('ledger').add(entry);
const notice = (tx: Tx, n: Omit<Notice, 'id'>) => tx.objectStore('notices').add({ ...n, id: uid('n-') });

// ————————————————— التهيئة —————————————————

/** أول تشغيل حقيقي فقط: أرصدة صفرية، الأبطال الخمسة مملوكون، الزعيمان مفتوحان. */
export async function initIfNeeded(db: DB, now = Date.now()): Promise<boolean> {
  return withTx(db, ['meta', 'profile', 'heroes', 'bosses'], async (tx) => {
    const init = await tx.objectStore('meta').get('initialized');
    if (init) return false;
    const profile: Profile = {
      id: 'main',
      xp: 0,
      coins: 0,
      gems: 0,
      coinsEarned: 0,
      coinsSpent: 0,
      gemsEarned: 0,
      gemsSpent: 0,
      createdAt: now,
      updatedAt: now,
    };
    await tx.objectStore('profile').put(profile);
    for (const h of CATALOG.heroes.filter((x) => x.starter)) {
      await tx.objectStore('heroes').put({ heroId: h.id, wins: 0, acquiredAt: now, source: 'starter' } satisfies OwnedHero);
    }
    for (const b of CATALOG.bosses.filter((x) => x.starter)) {
      await tx.objectStore('bosses').put({ bossId: b.id, unlockedAt: now, source: 'starter' } satisfies UnlockedBoss);
    }
    await tx.objectStore('meta').put({ key: 'settings', value: DEFAULT_SETTINGS });
    await tx.objectStore('meta').put({ key: 'schemaVersion', value: SCHEMA_VERSION });
    await tx.objectStore('meta').put({ key: 'initialized', value: now });
    return true;
  });
}

// ————————————————— استحقاقات الزعماء —————————————————

/** يطبّق الاستحقاقات غير المعيّنة عند توفر محتوى صالح مربوط بها، مرة واحدة. */
async function reconcileEntitlementsInTx(tx: Tx, now: number): Promise<string[]> {
  const unlockedNow: string[] = [];
  const all: BossEntitlement[] = await tx.objectStore('entitlements').getAll();
  for (const ent of all) {
    if (ent.bossId) continue;
    const configured = rankCompletionRewards[ent.rank]?.[ent.index] ?? null;
    if (!configured || !CATALOG.bossById.has(configured)) continue; // لا يُستهلك دون محتوى صالح
    const existing = await tx.objectStore('bosses').get(configured);
    if (existing) continue;
    await tx.objectStore('bosses').put({ bossId: configured, unlockedAt: now, source: ent.key } satisfies UnlockedBoss);
    await tx.objectStore('entitlements').put({ ...ent, bossId: configured, appliedAt: now });
    await ledger(tx, { id: `boss-unlock:${configured}`, type: 'boss-unlock', at: now, data: { bossId: configured, entitlement: ent.key } });
    await notice(tx, { at: now, kind: 'boss-unlock', data: { bossId: configured } });
    unlockedNow.push(configured);
  }
  return unlockedNow;
}

export async function reconcileEntitlements(db: DB, now = Date.now()): Promise<string[]> {
  return withTx(db, ['entitlements', 'bosses', 'ledger', 'notices'], (tx) => reconcileEntitlementsInTx(tx, now));
}

/** يضيف XP ويصرف كل الاستحقاقات بين القيمتين داخل نفس المعاملة. */
async function grantXpInTx(tx: Tx, profile: Profile, addXp: number, addCoins: number, now: number, cause: string) {
  const oldXp = profile.xp;
  const newXp = oldXp + addXp;
  if (!Number.isSafeInteger(newXp) || !Number.isSafeInteger(profile.coins + addCoins)) {
    throw new OpError('invalid', 'القيمة تتجاوز المجال العددي الآمن');
  }
  const milestones = milestonesBetween(oldXp, newXp);
  let gems = 0;
  for (const m of milestones) {
    if (m.kind === 'level' || m.kind === 'mastery') {
      gems += m.gems;
      await ledger(tx, {
        id: m.key,
        type: m.kind === 'level' ? 'level-up' : 'mastery',
        at: now,
        data: m.kind === 'level' ? { level: m.level, gems: m.gems, cause } : { cycle: m.cycle, gems: m.gems, cause },
      });
      await notice(tx, { at: now, kind: m.kind === 'level' ? 'level' : 'mastery', data: { ...m } });
    } else {
      await ledger(tx, { id: m.key, type: 'rank-complete', at: now, data: { rank: m.rank, bossSlots: m.bossSlots, cause } });
      for (let i = 0; i < m.bossSlots; i++) {
        const key = `rank:${m.rank}:${i}`;
        await tx.objectStore('entitlements').add({ key, rank: m.rank, index: i, earnedAt: now, bossId: null } satisfies BossEntitlement);
        await ledger(tx, { id: `boss-entitlement:${key}`, type: 'boss-entitlement', at: now, data: { rank: m.rank, index: i } });
      }
      await notice(tx, { at: now, kind: 'rank', data: { rank: m.rank, bossSlots: m.bossSlots } });
    }
  }
  profile.xp = newXp;
  profile.coins += addCoins;
  profile.coinsEarned += addCoins;
  profile.gems += gems;
  profile.gemsEarned += gems;
  profile.updatedAt = now;
  await tx.objectStore('profile').put(profile);
  return { milestones, gems };
}

// ————————————————— التحديات —————————————————

export interface CompleteResult {
  xp: number;
  coins: number;
  gems: number;
  levelsCompleted: number[];
  ranksCompleted: number[];
}

export async function completeChallenge(db: DB, challengeId: string, now: Date = new Date()): Promise<CompleteResult> {
  const ts = now.getTime();
  const dateKey = localDateKey(now);
  return withTx(db, ['challenges', 'completions', 'profile', 'ledger', 'entitlements', 'bosses', 'notices'], async (tx) => {
    const ch: Challenge | undefined = await tx.objectStore('challenges').get(challengeId);
    if (!ch || ch.archived) throw new OpError('not-found', 'التحدي غير موجود');
    const mine: Completion[] = await tx.objectStore('completions').index('byChallenge').getAll(challengeId);
    if (!canComplete(challengeId, ch.recurrence, dateKey, mine)) {
      throw new OpError('already-done', ch.recurrence === 'daily' ? 'كمّلتي هاد التحدي اليوم' : 'هاد الهدف مكمّل من قبل');
    }
    const reward = rewardFor(ch.difficulty, ch.customXp, ch.customCoins);
    const key = completionKey(challengeId, ch.recurrence, dateKey);
    const completion: Completion = {
      key,
      challengeId,
      kind: ch.recurrence,
      dateKey,
      at: ts,
      snapshot: { name: ch.name, difficulty: ch.difficulty, xp: reward.xp, coins: reward.coins, imageId: ch.imageId, recurrence: ch.recurrence },
    };
    await tx.objectStore('completions').add(completion); // المفتاح الفريد يمنع الازدواج
    const profile: Profile = await tx.objectStore('profile').get('main');
    await ledger(tx, { id: `challenge:${key}`, type: 'challenge-complete', at: ts, data: { challengeId, dateKey, ...completion.snapshot } });
    const { milestones, gems } = await grantXpInTx(tx, profile, reward.xp, reward.coins, ts, `challenge:${key}`);
    await reconcileEntitlementsInTx(tx, ts);
    return {
      xp: reward.xp,
      coins: reward.coins,
      gems,
      levelsCompleted: milestones.flatMap((m) => (m.kind === 'level' ? [m.level] : [])),
      ranksCompleted: milestones.flatMap((m) => (m.kind === 'rank' ? [m.rank] : [])),
    };
  });
}

export interface ChallengeInput {
  id?: string;
  name: string;
  description: string;
  imageId: string | null;
  difficulty: Challenge['difficulty'];
  customXp?: number;
  customCoins?: number;
  recurrence: Challenge['recurrence'];
}

export function validateChallengeInput(input: ChallengeInput): string | null {
  if (!input.name.trim()) return 'اكتب اسم التحدي';
  if (input.name.length > 120) return 'الاسم طويل جدًا';
  if (input.difficulty === 'open' && (!isValidRewardNumber(input.customXp) || !isValidRewardNumber(input.customCoins))) {
    return 'في «مفتوح» اكتب XP وCoins كأعداد صحيحة غير سالبة';
  }
  return null;
}

export async function saveChallenge(db: DB, input: ChallengeInput, now = Date.now()): Promise<Challenge> {
  const err = validateChallengeInput(input);
  if (err) throw new OpError('invalid', err);
  return withTx(db, ['challenges', 'completions'], async (tx) => {
    const store = tx.objectStore('challenges');
    const existing: Challenge | undefined = input.id ? await store.get(input.id) : undefined;
    if (input.id && !existing) throw new OpError('not-found', 'التحدي غير موجود');
    if (existing) {
      // مهمة مرة واحدة مكتملة لا يعيد التعديل تسليحها: نوعها يبقى كما هو
      const done = await tx.objectStore('completions').get(`${existing.id}|once`);
      if (done && input.recurrence !== existing.recurrence) {
        throw new OpError('invalid', 'هذا الهدف مكتمل؛ أنشئ تحديًا جديدًا بدل تغيير نوعه');
      }
    }
    const all: Challenge[] = existing ? [] : await store.getAll();
    const ch: Challenge = {
      id: existing?.id ?? uid('c-'),
      name: input.name.trim(),
      description: input.description.trim(),
      imageId: input.imageId,
      difficulty: input.difficulty,
      customXp: input.difficulty === 'open' ? input.customXp : undefined,
      customCoins: input.difficulty === 'open' ? input.customCoins : undefined,
      recurrence: input.recurrence,
      archived: existing?.archived ?? false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      order: existing?.order ?? all.length,
    };
    await store.put(ch);
    return ch;
  });
}

export async function archiveChallenge(db: DB, id: string, now = Date.now()): Promise<void> {
  await withTx(db, ['challenges'], async (tx) => {
    const ch: Challenge | undefined = await tx.objectStore('challenges').get(id);
    if (!ch) throw new OpError('not-found', 'التحدي غير موجود');
    await tx.objectStore('challenges').put({ ...ch, archived: true, updatedAt: now });
  });
}

// ————————————————— الجوائز —————————————————

export interface RewardInput {
  id?: string;
  name: string;
  description: string;
  imageId: string | null;
  price: number;
  recurrence: Reward['recurrence'];
}

export function validateRewardInput(input: RewardInput): string | null {
  if (!input.name.trim()) return 'اكتب اسم الجائزة';
  if (!isValidRewardNumber(input.price)) return 'الثمن عدد صحيح غير سالب';
  return null;
}

export async function saveReward(db: DB, input: RewardInput, now = Date.now()): Promise<Reward> {
  const err = validateRewardInput(input);
  if (err) throw new OpError('invalid', err);
  return withTx(db, ['rewards'], async (tx) => {
    const store = tx.objectStore('rewards');
    const existing: Reward | undefined = input.id ? await store.get(input.id) : undefined;
    if (input.id && !existing) throw new OpError('not-found', 'الجائزة غير موجودة');
    const all: Reward[] = existing ? [] : await store.getAll();
    const r: Reward = {
      id: existing?.id ?? uid('r-'),
      name: input.name.trim(),
      description: input.description.trim(),
      imageId: input.imageId,
      price: input.price,
      recurrence: input.recurrence,
      archived: existing?.archived ?? false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      order: existing?.order ?? all.length,
    };
    await store.put(r);
    return r;
  });
}

export async function archiveReward(db: DB, id: string, now = Date.now()): Promise<void> {
  await withTx(db, ['rewards'], async (tx) => {
    const r: Reward | undefined = await tx.objectStore('rewards').get(id);
    if (!r) throw new OpError('not-found', 'الجائزة غير موجودة');
    await tx.objectStore('rewards').put({ ...r, archived: true, updatedAt: now });
  });
}

/**
 * شراء جائزة. token يُنشأ عند فتح نافذة التأكيد: نفس التأكيد لا يُصرف مرتين،
 * والشراء المتكرر المقصود يحتاج تأكيدًا جديدًا (token جديد).
 */
export async function purchaseReward(db: DB, rewardId: string, token: string, now = Date.now()): Promise<Purchase> {
  return withTx(db, ['rewards', 'purchases', 'profile', 'ledger'], async (tx) => {
    if (await tx.objectStore('purchases').get(token)) throw new OpError('duplicate', 'تم تسجيل هذا الشراء من قبل');
    const r: Reward | undefined = await tx.objectStore('rewards').get(rewardId);
    if (!r || r.archived) throw new OpError('not-found', 'الجائزة غير متاحة');
    if (r.recurrence === 'once') {
      const prev = await tx.objectStore('purchases').index('byReward').count(rewardId);
      if (prev > 0) throw new OpError('already-done', 'هذه الجائزة اشتُريت من قبل');
    }
    const profile: Profile = await tx.objectStore('profile').get('main');
    if (profile.coins < r.price) {
      throw new OpError('insufficient', `ينقصك ${r.price - profile.coins} Coins`, { missing: r.price - profile.coins });
    }
    profile.coins -= r.price;
    profile.coinsSpent += r.price;
    profile.updatedAt = now;
    await tx.objectStore('profile').put(profile);
    const p: Purchase = { id: token, rewardId, at: now, snapshot: { name: r.name, price: r.price, imageId: r.imageId, recurrence: r.recurrence } };
    await tx.objectStore('purchases').add(p);
    await ledger(tx, { id: `purchase:${token}`, type: 'reward-purchase', at: now, data: { rewardId, ...p.snapshot } });
    return p;
  });
}

// ————————————————— الأبطال —————————————————

export async function buyHero(db: DB, heroId: string, now = Date.now()): Promise<void> {
  await withTx(db, ['heroes', 'profile', 'ledger', 'notices'], async (tx) => {
    const def = CATALOG.heroById.get(heroId);
    if (!def) throw new OpError('not-found', 'البطل غير متاح');
    if (await tx.objectStore('heroes').get(heroId)) throw new OpError('owned', 'هذا البطل مملوك');
    const price = def.gemPrice ?? HERO_PRICE_GEMS;
    const profile: Profile = await tx.objectStore('profile').get('main');
    if (profile.gems < price) throw new OpError('insufficient', `ينقصك ${price - profile.gems} جوهرة`, { missing: price - profile.gems });
    profile.gems -= price;
    profile.gemsSpent += price;
    profile.updatedAt = now;
    await tx.objectStore('profile').put(profile);
    await tx.objectStore('heroes').add({ heroId, wins: 0, acquiredAt: now, source: 'purchase' } satisfies OwnedHero);
    await ledger(tx, { id: `hero:${heroId}`, type: 'hero-purchase', at: now, data: { heroId, price } });
    await notice(tx, { at: now, kind: 'hero', data: { heroId } });
  });
}

// ————————————————— الوسائط —————————————————

export async function putBlob(db: DB, file: { data: ArrayBuffer; type: string; name: string }, purpose: StoredBlob['purpose'], now = Date.now()): Promise<StoredBlob> {
  const rec: StoredBlob = { id: uid('m-'), data: file.data, type: file.type, name: file.name, size: file.data.byteLength, purpose, createdAt: now };
  await withTx(db, ['blobs'], async (tx) => {
    await tx.objectStore('blobs').add(rec);
  });
  return rec;
}

export async function addTrack(db: DB, file: { data: ArrayBuffer; type: string; name: string }, now = Date.now()): Promise<Track> {
  return withTx(db, ['blobs', 'tracks'], async (tx) => {
    const blob: StoredBlob = { id: uid('m-'), data: file.data, type: file.type, name: file.name, size: file.data.byteLength, purpose: 'music', createdAt: now };
    await tx.objectStore('blobs').add(blob);
    const count = await tx.objectStore('tracks').count();
    const t: Track = { id: uid('t-'), blobId: blob.id, name: file.name.replace(/\.[^.]+$/, ''), type: file.type, size: blob.size, order: count, addedAt: now };
    await tx.objectStore('tracks').add(t);
    return t;
  });
}

export async function removeTrack(db: DB, trackId: string): Promise<void> {
  await withTx(db, ['blobs', 'tracks'], async (tx) => {
    const t: Track | undefined = await tx.objectStore('tracks').get(trackId);
    if (!t) return;
    await tx.objectStore('tracks').delete(trackId);
    await tx.objectStore('blobs').delete(t.blobId);
    const rest: Track[] = (await tx.objectStore('tracks').getAll()).sort((a: Track, b: Track) => a.order - b.order);
    for (let i = 0; i < rest.length; i++) if (rest[i].order !== i) await tx.objectStore('tracks').put({ ...rest[i], order: i });
  });
}

export async function reorderTracks(db: DB, orderedIds: string[]): Promise<void> {
  await withTx(db, ['tracks'], async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      const t: Track | undefined = await tx.objectStore('tracks').get(orderedIds[i]);
      if (t && t.order !== i) await tx.objectStore('tracks').put({ ...t, order: i });
    }
  });
}

// ————————————————— الإعدادات —————————————————

export async function saveSettings(db: DB, patch: Partial<Settings>): Promise<Settings> {
  return withTx(db, ['meta'], async (tx) => {
    const cur = (await tx.objectStore('meta').get('settings'))?.value ?? DEFAULT_SETTINGS;
    const next = { ...DEFAULT_SETTINGS, ...cur, ...patch };
    await tx.objectStore('meta').put({ key: 'settings', value: next });
    return next;
  });
}

export async function setMeta(db: DB, key: string, value: unknown): Promise<void> {
  await db.put('meta', { key, value });
}

export async function dismissNotice(db: DB, id: string): Promise<void> {
  await db.delete('notices', id);
}

export async function dismissAllNotices(db: DB): Promise<void> {
  await db.clear('notices');
}

// ————————————————— القتال —————————————————

const emptyBattle = (): BattleRecord => ({ id: 'current', rev: 0 });

async function getBattleRec(tx: Tx): Promise<BattleRecord> {
  return (await tx.objectStore('battle').get('current')) ?? emptyBattle();
}

function checkRev(rec: BattleRecord, expectedRev: number) {
  if (rec.rev !== expectedRev) throw new OpError('stale', 'تغيرت المعركة في نافذة أخرى؛ تم تحديث العرض.');
}

/** الزعماء المؤهلون للروليت: مفتوحون ولهم بيانات قتال صالحة في الكتالوج. */
export function eligibleBosses(unlocked: UnlockedBoss[]): string[] {
  return unlocked.map((u) => u.bossId).filter((id) => CATALOG.bossById.has(id));
}

/** تأكيد الفريق: يوزع الخانات ويحسب المرشحَين ويحفظهما فورًا فلا يعاد الرمي بإعادة التحميل. */
export async function confirmTeam(db: DB, expectedRev: number, selectedHeroIds: string[], now = Date.now()): Promise<BattleRecord> {
  return withTx(db, ['battle', 'heroes', 'bosses'], async (tx) => {
    const rec = await getBattleRec(tx);
    checkRev(rec, expectedRev);
    if (rec.state && !rec.state.outcome) throw new OpError('invalid', 'توجد معركة جارية');
    if (selectedHeroIds.length !== 5 || new Set(selectedHeroIds).size !== 5) throw new OpError('invalid', 'اختر خمسة أبطال مختلفين');
    for (const id of selectedHeroIds) {
      if (!(await tx.objectStore('heroes').get(id)) || !CATALOG.heroById.has(id)) throw new OpError('invalid', 'بطل غير مملوك');
    }
    const eligible = eligibleBosses(await tx.objectStore('bosses').getAll());
    if (!eligible.length) throw new OpError('invalid', 'لا يوجد زعيم مفتوح');
    const seed = randomSeed();
    const next: BattleRecord = {
      id: 'current',
      rev: rec.rev + 1,
      prep: { prepId: uid('p-'), teamHeroIds: assignSlots(selectedHeroIds), seed, candidates: rollBossCandidates(eligible, seed), createdAt: now },
    };
    await tx.objectStore('battle').put(next);
    return next;
  });
}

/** تغيير الفريق يبدأ تحضيرًا جديدًا. */
export async function cancelPrep(db: DB, expectedRev: number): Promise<BattleRecord> {
  return withTx(db, ['battle'], async (tx) => {
    const rec = await getBattleRec(tx);
    checkRev(rec, expectedRev);
    if (rec.state && !rec.state.outcome) throw new OpError('invalid', 'توجد معركة جارية');
    const next: BattleRecord = { id: 'current', rev: rec.rev + 1 };
    await tx.objectStore('battle').put(next);
    return next;
  });
}

export async function chooseBoss(db: DB, expectedRev: number, bossId: string): Promise<BattleRecord> {
  return withTx(db, ['battle', 'bosses'], async (tx) => {
    const rec = await getBattleRec(tx);
    checkRev(rec, expectedRev);
    if (!rec.prep) throw new OpError('invalid', 'لا يوجد تحضير');
    if (!rec.prep.candidates.includes(bossId)) throw new OpError('invalid', 'الزعيم ليس من المرشحَين');
    if (!(await tx.objectStore('bosses').get(bossId))) throw new OpError('invalid', 'الزعيم مقفل');
    const state = createBattle({ battleId: uid('b-'), seed: rec.prep.seed, bossId, teamHeroIds: rec.prep.teamHeroIds });
    const next: BattleRecord = { id: 'current', rev: rec.rev + 1, prep: rec.prep, state };
    await tx.objectStore('battle').put(next);
    return next;
  });
}

async function settleIfEnded(tx: Tx, rec: BattleRecord, now: number): Promise<void> {
  const s = rec.state;
  if (!s?.outcome || rec.settled?.battleId === s.battleId) return;
  const ledgerId = `battle:${s.battleId}`;
  if (await tx.objectStore('ledger').get(ledgerId)) return; // صُرفت من قبل
  const winners = battleWinners(s);
  const levelUps: Array<{ heroId: string; level: number }> = [];
  for (const heroId of winners) {
    const h: OwnedHero | undefined = await tx.objectStore('heroes').get(heroId);
    if (!h) continue;
    const before = cosmeticLevel(h.wins);
    const updated = { ...h, wins: h.wins + 1 };
    await tx.objectStore('heroes').put(updated);
    const after = cosmeticLevel(updated.wins);
    if (after > before) {
      levelUps.push({ heroId, level: after });
      await ledger(tx, { id: `cosmetic:${heroId}:${after}`, type: 'cosmetic-level', at: now, data: { heroId, level: after, wins: updated.wins } });
      await notice(tx, { at: now, kind: 'cosmetic', data: { heroId, level: after } });
    }
  }
  const rounds = s.round;
  await ledger(tx, { id: ledgerId, type: 'battle-result', at: now, data: { battleId: s.battleId, bossId: s.bossId, outcome: s.outcome, rounds, team: s.teamHeroIds, winners } });
  rec.settled = { battleId: s.battleId, outcome: s.outcome, winners, levelUps, rounds };
}

/** ينفذ الجولة ويحفظ النتيجة وسجل الأحداث ومكافآت النهاية في معاملة واحدة. */
export async function commitRound(db: DB, expectedRev: number, plan: PlannedCard[], now = Date.now()): Promise<BattleRecord> {
  return withTx(db, ['battle', 'heroes', 'ledger', 'notices'], async (tx) => {
    const rec = await getBattleRec(tx);
    checkRev(rec, expectedRev);
    if (!rec.state || rec.state.outcome) throw new OpError('invalid', 'لا توجد معركة جارية');
    const { state, record } = executeRound(rec.state, plan);
    const next: BattleRecord = { ...rec, rev: rec.rev + 1, state, execution: { ...record, cursor: 0 } };
    await settleIfEnded(tx, next, now);
    await tx.objectStore('battle').put(next);
    return next;
  });
}

export async function retreatBattle(db: DB, expectedRev: number, now = Date.now()): Promise<BattleRecord> {
  return withTx(db, ['battle', 'heroes', 'ledger', 'notices'], async (tx) => {
    const rec = await getBattleRec(tx);
    checkRev(rec, expectedRev);
    if (!rec.state || rec.state.outcome) throw new OpError('invalid', 'لا توجد معركة جارية');
    const next: BattleRecord = { ...rec, rev: rec.rev + 1, state: retreat(rec.state), execution: undefined };
    await settleIfEnded(tx, next, now);
    await tx.objectStore('battle').put(next);
    return next;
  });
}

/** يحفظ مؤشر عرض الأحداث فقط؛ لا يغير الحسابات. */
export async function setPlaybackCursor(db: DB, executionId: string, cursor: number): Promise<void> {
  await withTx(db, ['battle'], async (tx) => {
    const rec = await getBattleRec(tx);
    if (!rec.execution || rec.execution.id !== executionId || rec.execution.cursor >= cursor) return;
    await tx.objectStore('battle').put({ ...rec, execution: { ...rec.execution, cursor } });
  });
}

/** بعد شاشة النتيجة: يعود لاختيار الفريق (لا إعادة لنفس المعركة). */
export async function finishBattle(db: DB, expectedRev: number): Promise<BattleRecord> {
  return withTx(db, ['battle'], async (tx) => {
    const rec = await getBattleRec(tx);
    checkRev(rec, expectedRev);
    if (rec.state && !rec.state.outcome) throw new OpError('invalid', 'المعركة ما زالت جارية');
    const next: BattleRecord = { id: 'current', rev: rec.rev + 1 };
    await tx.objectStore('battle').put(next);
    return next;
  });
}

// ————————————————— القراءة —————————————————

export interface AppData {
  profile: Profile;
  settings: Settings;
  heroes: OwnedHero[];
  bosses: UnlockedBoss[];
  entitlements: BossEntitlement[];
  challenges: Challenge[];
  completions: Completion[];
  rewards: Reward[];
  purchasedOnce: string[];
  tracks: Track[];
  battle: BattleRecord;
  notices: Notice[];
  todayKey: string;
  meta: Record<string, unknown>;
}

export async function loadAll(db: DB, now: Date = new Date()): Promise<AppData> {
  const todayKey = localDateKey(now);
  const tx = db.transaction(
    ['profile', 'meta', 'heroes', 'bosses', 'entitlements', 'challenges', 'completions', 'rewards', 'purchases', 'tracks', 'battle', 'notices'],
    'readonly',
  );
  const [profile, metaAll, heroes, bosses, entitlements, challenges, today, once, rewards, purchases, tracks, battle, notices] = await Promise.all([
    tx.objectStore('profile').get('main'),
    tx.objectStore('meta').getAll(),
    tx.objectStore('heroes').getAll(),
    tx.objectStore('bosses').getAll(),
    tx.objectStore('entitlements').getAll(),
    tx.objectStore('challenges').getAll(),
    tx.objectStore('completions').index('byDate').getAll(todayKey),
    tx.objectStore('completions').index('byKind').getAll('once'),
    tx.objectStore('rewards').getAll(),
    tx.objectStore('purchases').getAll(),
    tx.objectStore('tracks').getAll(),
    tx.objectStore('battle').get('current'),
    tx.objectStore('notices').getAll(),
  ]);
  await tx.done;
  const meta: Record<string, unknown> = Object.fromEntries((metaAll as Array<{ key: string; value: unknown }>).map((m) => [m.key, m.value]));
  const onceRewardIds = new Set((rewards as Reward[]).filter((r) => r.recurrence === 'once').map((r) => r.id));
  const completionMap = new Map<string, Completion>();
  for (const c of [...(today as Completion[]), ...(once as Completion[])]) completionMap.set(c.key, c);
  return {
    profile,
    settings: { ...DEFAULT_SETTINGS, ...((meta.settings as Settings) ?? {}) },
    heroes,
    bosses,
    entitlements,
    challenges: (challenges as Challenge[]).sort((a, b) => a.order - b.order),
    completions: [...completionMap.values()],
    rewards: (rewards as Reward[]).sort((a, b) => a.order - b.order),
    purchasedOnce: [...new Set((purchases as Purchase[]).filter((p) => onceRewardIds.has(p.rewardId)).map((p) => p.rewardId))],
    tracks: (tracks as Track[]).sort((a, b) => a.order - b.order),
    battle: battle ?? emptyBattle(),
    notices: (notices as Notice[]).sort((a, b) => a.at - b.at),
    todayKey,
    meta,
  };
}

export async function getBlob(db: DB, id: string): Promise<StoredBlob | undefined> {
  return db.get('blobs', id);
}

export async function listLedger(db: DB, opts: { types?: string[]; limit?: number; before?: number } = {}): Promise<LedgerEntry[]> {
  const limit = opts.limit ?? 50;
  const out: LedgerEntry[] = [];
  const range = opts.before !== undefined ? IDBKeyRange.upperBound(opts.before, true) : undefined;
  let cursor = await db.transaction('ledger').store.index('byAt').openCursor(range, 'prev');
  while (cursor && out.length < limit) {
    const v = cursor.value as LedgerEntry;
    if (!opts.types || opts.types.includes(v.type)) out.push(v);
    cursor = await cursor.continue();
  }
  return out;
}

export async function listCompletions(db: DB, challengeId: string): Promise<Completion[]> {
  return db.getAllFromIndex('completions', 'byChallenge', challengeId);
}
