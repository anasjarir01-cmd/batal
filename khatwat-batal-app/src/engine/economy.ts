// قواعد التحديات والجوائز والمستوى التجميلي. دوال نقية.

export type Difficulty = 'very-easy' | 'easy' | 'medium' | 'hard' | 'very-hard' | 'legendary' | 'open';
export type Recurrence = 'daily' | 'once';

export const DIFFICULTIES: Array<{ id: Difficulty; label: string; xp: number | null; coins: number | null }> = [
  { id: 'very-easy', label: 'سهل جدًا', xp: 10, coins: 2 },
  { id: 'easy', label: 'سهل', xp: 20, coins: 4 },
  { id: 'medium', label: 'متوسط', xp: 40, coins: 8 },
  { id: 'hard', label: 'صعب', xp: 80, coins: 16 },
  { id: 'very-hard', label: 'صعب جدًا', xp: 160, coins: 32 },
  { id: 'legendary', label: 'أسطوري', xp: 1000, coins: 200 },
  { id: 'open', label: 'مفتوح', xp: null, coins: null },
];

export const DIFFICULTY_LABEL: Record<Difficulty, string> = Object.fromEntries(
  DIFFICULTIES.map((d) => [d.id, d.label]),
) as Record<Difficulty, string>;

/** أقصى قيمة مسموحة لمكافأة مفتوحة: مجال عددي آمن دون سقف توازن. */
export const MAX_OPEN_REWARD = 1_000_000_000_000;

export interface ChallengeReward {
  xp: number;
  coins: number;
}

export function isValidRewardNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= MAX_OPEN_REWARD;
}

export function rewardFor(difficulty: Difficulty, customXp?: number, customCoins?: number): ChallengeReward {
  if (difficulty === 'open') {
    if (!isValidRewardNumber(customXp) || !isValidRewardNumber(customCoins)) {
      throw new RangeError('قيم المكافأة المفتوحة يجب أن تكون أعدادًا صحيحة غير سالبة');
    }
    return { xp: customXp, coins: customCoins };
  }
  const d = DIFFICULTIES.find((x) => x.id === difficulty);
  if (!d || d.xp === null || d.coins === null) throw new RangeError('صعوبة غير معروفة');
  return { xp: d.xp, coins: d.coins };
}

/** مفتاح الاستحقاق الفريد: يومي (id, localDateKey) أو مرة واحدة (id, once). */
export function completionKey(challengeId: string, recurrence: Recurrence, dateKey: string): string {
  return recurrence === 'daily' ? `${challengeId}|${dateKey}` : `${challengeId}|once`;
}

export interface CompletionLike {
  challengeId: string;
  key: string;
  dateKey: string;
}

/**
 * هل يمكن إكمال التحدي الآن؟
 * - مهمة مرة واحدة أُكملت مرة لا تُعاد مهما تغيّر نوعها.
 * - اليومي: مرة في كل يوم محلي.
 * - تغيير النوع في نفس اليوم لا يستعمل لإعادة منح استحقاق اليوم نفسه.
 */
export function canComplete(
  challengeId: string,
  _recurrence: Recurrence,
  todayKey: string,
  completions: CompletionLike[],
): boolean {
  const mine = completions.filter((c) => c.challengeId === challengeId);
  if (mine.some((c) => c.key === `${challengeId}|once`)) return false;
  if (mine.some((c) => c.dateKey === todayKey)) return false;
  return true;
}

// ——— المستوى التجميلي للأبطال ———
export const COSMETIC_THRESHOLDS = [0, 20, 100, 250, 600] as const;

export function cosmeticLevel(wins: number): number {
  let lvl = 1;
  for (let i = 0; i < COSMETIC_THRESHOLDS.length; i++) if (wins >= COSMETIC_THRESHOLDS[i]) lvl = i + 1;
  return lvl;
}

export function nextCosmeticThreshold(wins: number): number | null {
  for (const t of COSMETIC_THRESHOLDS) if (wins < t) return t;
  return null;
}

export const HERO_PRICE_GEMS = 100;
