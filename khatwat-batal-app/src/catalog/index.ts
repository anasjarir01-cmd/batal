import assetIndex from './assetIndex.generated.json';
import { BOSSES, BOSS_ABILITIES } from './bosses';
import { HEROES, HERO_ABILITIES } from './heroes';
import type { AbilityDef, BossDef, Effect, HeroDef } from './types';
import { BOSS_SLOTS_PER_RANK, rankCompletionRewards } from './unlocks';

export * from './types';
export { BOSS_SLOTS_PER_RANK, rankCompletionRewards };

export interface AssetEntry {
  original: string;
  display: string;
  originalBytes: number;
  displayBytes: number;
  sha256: string;
  width: number;
  height: number;
  displayWidth: number;
  displayHeight: number;
}

export const ASSETS: AssetEntry[] = assetIndex as AssetEntry[];
const assetByPath = new Map(ASSETS.map((a) => [a.original, a]));

/** رابط نسخة العرض المحسنة (مطابقة بصريًا) لاستعمالها في البطاقات الصغيرة. */
export function displayUrl(path: string): string {
  return assetByPath.get(path)?.display ?? path;
}
/** رابط الأصل PNG كما هو، لعرض التفاصيل والتكبير. */
export function originalUrl(path: string): string {
  return path;
}

export interface Catalog {
  heroes: HeroDef[];
  bosses: BossDef[];
  abilities: Map<string, AbilityDef>;
  heroById: Map<string, HeroDef>;
  bossById: Map<string, BossDef>;
  /** محتوى غير صالح عُزل مع السبب. */
  problems: string[];
}

const KNOWN_EFFECTS = new Set<Effect['type']>([
  'damage',
  'shield',
  'heal',
  'cleanse',
  'removeBarrier',
  'dot',
  'huntMark',
  'expose',
  'focus',
  'weaken',
]);

const isNonNegInt = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0;

function validateAbility(a: AbilityDef, kind: 'hero' | 'boss', problems: string[]): boolean {
  const before = problems.length;
  const p = (m: string) => problems.push(`القدرة ${a.id}: ${m}`);
  if (!assetByPath.has(a.image)) p(`صورة غير موجودة ${a.image}`);
  if (kind === 'hero') {
    if (!Number.isInteger(a.cost) || (a.cost as number) < 1 || (a.cost as number) > 7) p('كلفة غير صالحة');
    if (!a.heroTarget) p('قاعدة هدف البطل ناقصة');
    if (a.bossTarget) p('قاعدة هدف زعيم على قدرة بطل');
  } else {
    if (a.cost !== undefined) p('قدرات الزعيم بلا كلفة طاقة');
    if (!a.bossTarget) p('قاعدة هدف الزعيم ناقصة');
  }
  if (!a.effects.length) p('بلا تأثيرات');
  for (const e of a.effects) {
    if (!KNOWN_EFFECTS.has(e.type)) {
      p(`تأثير غير مدعوم ${(e as { type: string }).type}`);
      continue;
    }
    if ('amount' in e && !isNonNegInt(e.amount)) p(`مقدار غير صالح في ${e.type}`);
    if (e.target === 'chosen' && a.heroTarget === 'none') p('هدف مختار دون قاعدة اختيار');
    if (kind === 'hero' && (e.target === 'bossTargets')) p('هدف زعيم في قدرة بطل');
    if (kind === 'boss' && (e.target === 'chosen' || e.target === 'allHeroes' || e.target === 'otherHeroes' || e.target === 'boss'))
      p('هدف بطل في قدرة زعيم');
    if (kind === 'boss' && e.target === 'bossTargets' && a.bossTarget === 'self') p('أهداف أبطال مع قاعدة self');
    if (e.type === 'dot' && (!isNonNegInt(e.ticks) || e.ticks < 1)) p('مدة غير صالحة');
    if (e.type === 'expose' && (!isNonNegInt(e.charges) || e.charges < 1)) p('شحنات غير صالحة');
  }
  return problems.length === before;
}

/** يبني الكتالوج ويتحقق منه؛ المحتوى غير الصالح يُعزل بدل تعطيل التطبيق. */
export function buildCatalog(
  heroes: HeroDef[] = HEROES,
  bosses: BossDef[] = BOSSES,
  abilities: AbilityDef[] = [...HERO_ABILITIES, ...BOSS_ABILITIES],
): Catalog {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const c of [...heroes, ...bosses]) {
    if (ids.has(c.id)) problems.push(`معرّف مكرر ${c.id}`);
    ids.add(c.id);
  }
  const abilityMap = new Map<string, AbilityDef>();
  for (const a of abilities) {
    if (abilityMap.has(a.id)) problems.push(`معرّف قدرة مكرر ${a.id}`);
    abilityMap.set(a.id, a);
  }
  const validHeroes: HeroDef[] = [];
  for (const h of heroes) {
    const before = problems.length;
    if (!Number.isInteger(h.maxHp) || h.maxHp <= 0) problems.push(`${h.id}: حياة قصوى غير صالحة`);
    if (h.levelImages.length !== 5) problems.push(`${h.id}: يلزم 5 صور مستويات`);
    for (const img of h.levelImages) if (!assetByPath.has(img)) problems.push(`${h.id}: صورة مفقودة ${img}`);
    if (h.abilityIds.length !== 4) problems.push(`${h.id}: يلزم 4 قدرات`);
    for (const aid of h.abilityIds) {
      const a = abilityMap.get(aid);
      if (!a) problems.push(`${h.id}: قدرة غير معرّفة ${aid}`);
      else if (a.ownerId !== h.id) problems.push(`${h.id}: القدرة ${aid} لصاحب آخر`);
      else validateAbility(a, 'hero', problems);
    }
    if (problems.length === before) validHeroes.push(h);
  }
  const validBosses: BossDef[] = [];
  for (const b of bosses) {
    const before = problems.length;
    if (!Number.isInteger(b.maxHp) || b.maxHp <= 0) problems.push(`${b.id}: حياة قصوى غير صالحة`);
    if (!assetByPath.has(b.image)) problems.push(`${b.id}: صورة مفقودة`);
    if (b.abilityIds.length !== 9) problems.push(`${b.id}: يلزم 9 قدرات`);
    for (const aid of b.abilityIds) {
      const a = abilityMap.get(aid);
      if (!a) problems.push(`${b.id}: قدرة غير معرّفة ${aid}`);
      else if (a.ownerId !== b.id) problems.push(`${b.id}: القدرة ${aid} لصاحب آخر`);
      else validateAbility(a, 'boss', problems);
    }
    if (problems.length === before) validBosses.push(b);
  }
  for (const [rank, slots] of Object.entries(rankCompletionRewards)) {
    if (slots.length !== BOSS_SLOTS_PER_RANK[Number(rank)]) problems.push(`عدد خانات مكافأة الرتبة ${rank} غير صحيح`);
  }
  return {
    heroes: validHeroes,
    bosses: validBosses,
    abilities: abilityMap,
    heroById: new Map(validHeroes.map((h) => [h.id, h])),
    bossById: new Map(validBosses.map((b) => [b.id, b])),
    problems,
  };
}

export const CATALOG = buildCatalog();

export function ability(id: string): AbilityDef {
  const a = CATALOG.abilities.get(id);
  if (!a) throw new Error(`قدرة غير معروفة ${id}`);
  return a;
}

export function heroImageForLevel(hero: HeroDef, cosmeticLevel: number): string {
  const i = Math.max(1, Math.min(5, cosmeticLevel)) - 1;
  return hero.levelImages[i];
}
