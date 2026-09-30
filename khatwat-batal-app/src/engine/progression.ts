// محرك تقدم الحساب: مستويات ورتب وجواهر واستحقاقات الزعماء. دوال نقية بأعداد صحيحة،
// كل شيء مشتق من مجموع XP التراكمي فقط حتى لا تتباعد العدادات.
import { BOSS_SLOTS_PER_RANK } from '../catalog/unlocks';

export const MAX_LEVEL = 45;
export const LEVELS_PER_RANK = 5;
export const MAX_RANK = 9;
export const MASTERY_COST = 9180;
export const MASTERY_GEMS = 60;

export const RANK_NAMES: Record<number, string> = {
  1: 'المبتدئ',
  2: 'المقاتل',
  3: 'الفارس',
  4: 'القائد',
  5: 'البطل',
  6: 'الفاتح',
  7: 'الملك',
  8: 'الإمبراطور',
  9: 'الأسطورة',
};

/** XP اللازم لإكمال شريط المستوى n (1..45). */
export function levelCost(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) throw new RangeError(`مستوى غير صالح ${level}`);
  if (level <= 10) return 3060;
  if (level <= 25) return 6120;
  return 9180;
}

/** XP التراكمي عند الدخول إلى المستوى n (1..46؛ 46 = إكمال المستوى 45). */
export function xpToEnter(level: number): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += levelCost(l);
  return total;
}

export const XP_ALL_LEVELS = xpToEnter(MAX_LEVEL + 1); // 306000

/** الجواهر الفعلية عند إكمال شريط المستوى n (أساسية + بونيس بداية). */
export function gemsForLevel(level: number): number {
  if (level >= 1 && level <= 4) return 100;
  if (level === 5) return 20;
  if (level >= 6 && level <= 10) return 60;
  if (level >= 11 && level <= 12) return 100;
  if (level >= 13 && level <= 25) return 40;
  if (level >= 26 && level <= 45) return 60;
  throw new RangeError(`مستوى غير صالح ${level}`);
}

export function rankOfLevel(level: number): number {
  return Math.min(MAX_RANK, Math.floor((level - 1) / LEVELS_PER_RANK) + 1);
}

export interface ProgressInfo {
  xp: number;
  /** عدد أشرطة المستويات المكتملة (0..45). */
  completedLevels: number;
  /** المستوى الحالي (1..45). بعد إكمال 45 يبقى 45 ويظهر شريط الإتقان. */
  level: number;
  rank: number;
  rankName: string;
  /** عدد الرتب المكتملة (0..9). */
  completedRanks: number;
  /** XP داخل الشريط الحالي (مستوى أو إتقان). */
  barXp: number;
  barCost: number;
  maxed: boolean;
  masteryCycles: number;
}

export function progressFromXp(xp: number): ProgressInfo {
  if (!Number.isSafeInteger(xp) || xp < 0) throw new RangeError('XP غير صالح');
  if (xp >= XP_ALL_LEVELS) {
    const extra = xp - XP_ALL_LEVELS;
    return {
      xp,
      completedLevels: MAX_LEVEL,
      level: MAX_LEVEL,
      rank: MAX_RANK,
      rankName: RANK_NAMES[MAX_RANK],
      completedRanks: MAX_RANK,
      barXp: extra % MASTERY_COST,
      barCost: MASTERY_COST,
      maxed: true,
      masteryCycles: Math.floor(extra / MASTERY_COST),
    };
  }
  let level = 1;
  let acc = 0;
  while (level <= MAX_LEVEL && acc + levelCost(level) <= xp) {
    acc += levelCost(level);
    level++;
  }
  const completedLevels = level - 1;
  const rank = rankOfLevel(level);
  return {
    xp,
    completedLevels,
    level,
    rank,
    rankName: RANK_NAMES[rank],
    completedRanks: Math.floor(completedLevels / LEVELS_PER_RANK),
    barXp: xp - acc,
    barCost: levelCost(level),
    maxed: false,
    masteryCycles: 0,
  };
}

export type Milestone =
  | { kind: 'level'; level: number; gems: number; key: string }
  | { kind: 'rank'; rank: number; bossSlots: number; key: string }
  | { kind: 'mastery'; cycle: number; gems: number; key: string };

/** كل الاستحقاقات التي تقع بين مجموعين تراكميين (oldXp, newXp]. كل مفتاح فريد ويُصرف مرة واحدة. */
export function milestonesBetween(oldXp: number, newXp: number): Milestone[] {
  if (newXp < oldXp) throw new RangeError('XP لا ينقص');
  const a = progressFromXp(oldXp);
  const b = progressFromXp(newXp);
  const out: Milestone[] = [];
  for (let l = a.completedLevels + 1; l <= b.completedLevels; l++) {
    out.push({ kind: 'level', level: l, gems: gemsForLevel(l), key: `level:${l}` });
    if (l % LEVELS_PER_RANK === 0) {
      const rank = l / LEVELS_PER_RANK;
      out.push({ kind: 'rank', rank, bossSlots: BOSS_SLOTS_PER_RANK[rank] ?? 0, key: `rank:${rank}` });
    }
  }
  for (let c = a.masteryCycles + 1; c <= b.masteryCycles; c++) {
    out.push({ kind: 'mastery', cycle: c, gems: MASTERY_GEMS, key: `mastery:${c}` });
  }
  return out;
}

/** مجموع الجواهر المكتسبة من التقدم عند XP معين (قبل خصم المشتريات). */
export function gemsEarnedAtXp(xp: number): number {
  return milestonesBetween(0, xp).reduce((s, m) => s + (m.kind === 'rank' ? 0 : m.gems), 0);
}

/** عدد استحقاقات الزعماء المكتسبة عند XP معين (دون الزعيمين المجانيين). */
export function bossEntitlementsAtXp(xp: number): number {
  return milestonesBetween(0, xp).reduce((s, m) => s + (m.kind === 'rank' ? m.bossSlots : 0), 0);
}
