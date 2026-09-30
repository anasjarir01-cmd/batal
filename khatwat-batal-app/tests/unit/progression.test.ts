import { describe, expect, it } from 'vitest';
import { BOSS_SLOTS_PER_RANK } from '../../src/catalog/unlocks';
import { localDateKey } from '../../src/engine/dates';
import { canComplete, completionKey, cosmeticLevel, rewardFor } from '../../src/engine/economy';
import {
  bossEntitlementsAtXp,
  gemsEarnedAtXp,
  levelCost,
  milestonesBetween,
  progressFromXp,
  XP_ALL_LEVELS,
  xpToEnter,
} from '../../src/engine/progression';

describe('مكافآت التحديات', () => {
  it('1: 16 تحديًا بالتوزيع المذكور = 510 XP و102 Coins؛ سبعة أيام = 3570 و714', () => {
    const day = [
      ...Array(5).fill('very-easy'),
      ...Array(5).fill('easy'),
      ...Array(3).fill('medium'),
      ...Array(3).fill('hard'),
    ].map((d) => rewardFor(d));
    const xp = day.reduce((s, r) => s + r.xp, 0);
    const coins = day.reduce((s, r) => s + r.coins, 0);
    expect(xp).toBe(510);
    expect(coins).toBe(102);
    expect(xp * 7).toBe(3570);
    expect(coins * 7).toBe(714);
  });

  it('جدول الصعوبات ثابت، والمفتوح يقبل أعدادًا صحيحة غير سالبة كبيرة', () => {
    expect(rewardFor('very-hard')).toEqual({ xp: 160, coins: 32 });
    expect(rewardFor('legendary')).toEqual({ xp: 1000, coins: 200 });
    expect(rewardFor('open', 50000, 0)).toEqual({ xp: 50000, coins: 0 });
    expect(() => rewardFor('open', -1, 5)).toThrow();
    expect(() => rewardFor('open', 1.5, 5)).toThrow();
  });
});

describe('التاريخ المحلي والتجدد اليومي', () => {
  it('3: localDateKey من المكونات المحلية لا UTC (TZ=America/New_York)', () => {
    expect(process.env.TZ).toBe('America/New_York');
    // 23:30 بتوقيت نيويورك = 03:30 UTC من اليوم التالي
    const d = new Date(2026, 5, 10, 23, 30);
    expect(localDateKey(d)).toBe('2026-06-10');
    expect(d.toISOString().slice(0, 10)).toBe('2026-06-11');
  });

  it('3: اليومي يتجدد بعد منتصف الليل المحلي والمرة الواحدة لا تتجدد', () => {
    const completions = [{ challengeId: 'a', key: completionKey('a', 'daily', '2026-06-10'), dateKey: '2026-06-10' }];
    expect(canComplete('a', 'daily', '2026-06-10', completions)).toBe(false);
    expect(canComplete('a', 'daily', '2026-06-11', completions)).toBe(true);
    const once = [{ challengeId: 'b', key: completionKey('b', 'once', '2026-06-10'), dateKey: '2026-06-10' }];
    expect(canComplete('b', 'once', '2026-06-11', once)).toBe(false);
    expect(canComplete('b', 'once', '2027-01-01', once)).toBe(false);
    // تحويل مكتملة لمرة واحدة إلى يومي لا يعيد تسليحها
    expect(canComplete('b', 'daily', '2027-01-01', once)).toBe(false);
    // تحويل يومي أُكمل اليوم إلى مرة واحدة لا يمنح استحقاق اليوم مرتين
    expect(canComplete('a', 'once', '2026-06-10', completions)).toBe(false);
    expect(canComplete('a', 'once', '2026-06-11', completions)).toBe(true);
  });

  it('3: تغير التوقيت الصيفي لا يمنح يومًا إضافيًا (يوم 25 ساعة)', () => {
    // 1 نوفمبر 2026 في نيويورك طوله 25 ساعة
    const start = new Date(2026, 10, 1, 0, 10);
    const late = new Date(2026, 10, 1, 23, 50);
    expect(late.getTime() - start.getTime()).toBeGreaterThan(24 * 3600 * 1000);
    expect(localDateKey(start)).toBe(localDateKey(late));
    const done = [{ challengeId: 'a', key: completionKey('a', 'daily', localDateKey(start)), dateKey: localDateKey(start) }];
    expect(canComplete('a', 'daily', localDateKey(late), done)).toBe(false);
    // يوم 23 ساعة (8 مارس 2026) ثم منتصف الليل التالي
    const m1 = new Date(2026, 2, 8, 0, 30);
    const m2 = new Date(2026, 2, 9, 0, 5);
    expect(m2.getTime() - m1.getTime()).toBeLessThan(24 * 3600 * 1000);
    expect(localDateKey(m1)).toBe('2026-03-08');
    expect(localDateKey(m2)).toBe('2026-03-09');
  });
});

describe('المستويات والرتب والجواهر', () => {
  it('أشرطة المستويات والعتبات', () => {
    expect(levelCost(1)).toBe(3060);
    expect(levelCost(10)).toBe(3060);
    expect(levelCost(11)).toBe(6120);
    expect(levelCost(25)).toBe(6120);
    expect(levelCost(26)).toBe(9180);
    expect(levelCost(45)).toBe(9180);
    expect(XP_ALL_LEVELS).toBe(306000);
  });

  it('5: عتبات Level1–6 والجواهر واستحقاق الزعيم', () => {
    let p = progressFromXp(3059);
    expect([p.level, p.rank, gemsEarnedAtXp(3059)]).toEqual([1, 1, 0]);
    p = progressFromXp(3060);
    expect([p.level, gemsEarnedAtXp(3060)]).toEqual([2, 100]);
    p = progressFromXp(12240);
    expect([p.level, p.rank, p.completedRanks, gemsEarnedAtXp(12240)]).toEqual([5, 1, 0, 400]);
    expect(bossEntitlementsAtXp(12240)).toBe(0);
    p = progressFromXp(15300);
    expect([p.level, p.rank, p.completedRanks, gemsEarnedAtXp(15300)]).toEqual([6, 2, 1, 420]);
    expect(bossEntitlementsAtXp(15300)).toBe(1);
  });

  it('6: Level11/Rank3 = 720 جوهرة، Level13 = 920 جوهرة، وكل عتبات الرتب التسع', () => {
    expect([progressFromXp(30600).level, progressFromXp(30600).rank, gemsEarnedAtXp(30600)]).toEqual([11, 3, 720]);
    expect([progressFromXp(42840).level, gemsEarnedAtXp(42840)]).toEqual([13, 920]);
    const rankEntry: Record<number, number> = { 1: 0, 2: 15300, 3: 30600, 4: 61200, 5: 91800, 6: 122400, 7: 168300, 8: 214200, 9: 260100 };
    for (const [rank, xp] of Object.entries(rankEntry)) {
      const r = Number(rank);
      expect(xpToEnter((r - 1) * 5 + 1)).toBe(xp);
      expect(progressFromXp(xp).rank).toBe(r);
      if (xp > 0) expect(progressFromXp(xp - 1).rank).toBe(r - 1);
      expect(progressFromXp(xp + 1).rank).toBe(r);
    }
    // كل أشرطة المستويات: قبل العتبة/عندها/بعدها
    for (let l = 1; l <= 45; l++) {
      const enter = xpToEnter(l);
      expect(progressFromXp(enter).level).toBe(l);
      expect(progressFromXp(enter).barXp).toBe(0);
      if (enter > 0) expect(progressFromXp(enter - 1).level).toBe(l - 1);
      expect(progressFromXp(enter + 1).level).toBe(l);
    }
  });

  it('7: XP306000 = Rank9 مكتمل، 18 استحقاق زعيم، 2640 جوهرة؛ 315180 يمنح 60 لدورة الإتقان', () => {
    const p = progressFromXp(306000);
    expect(p.completedRanks).toBe(9);
    expect(p.completedLevels).toBe(45);
    expect(p.maxed).toBe(true);
    expect(bossEntitlementsAtXp(306000)).toBe(18);
    expect(Object.values(BOSS_SLOTS_PER_RANK).reduce((a, b) => a + b, 0)).toBe(18);
    expect(gemsEarnedAtXp(306000)).toBe(2640);
    expect(progressFromXp(305999).completedRanks).toBe(8);
    expect(gemsEarnedAtXp(315179)).toBe(2640);
    expect(gemsEarnedAtXp(315180)).toBe(2700);
    const ms = milestonesBetween(306000, 315180);
    expect(ms).toEqual([{ kind: 'mastery', cycle: 1, gems: 60, key: 'mastery:1' }]);
    expect(bossEntitlementsAtXp(10_000_000)).toBe(18);
  });

  it('8: مكافأة واحدة تعبر مستويات عديدة تسوي كل شريط مرة واحدة وتحتفظ بالفائض', () => {
    const ms = milestonesBetween(1000, 1000 + 40000);
    const levels = ms.filter((m) => m.kind === 'level').map((m) => (m.kind === 'level' ? m.level : 0));
    expect(levels).toEqual(Array.from({ length: levels.length }, (_, i) => i + 1));
    expect(new Set(ms.map((m) => m.key)).size).toBe(ms.length);
    const p = progressFromXp(41000);
    expect(xpToEnter(p.level) + p.barXp).toBe(41000);
    // تقسيم نفس المكافأة إلى خطوات يعطي نفس الاستحقاقات
    const stepped = [...milestonesBetween(1000, 20000), ...milestonesBetween(20000, 41000)];
    expect(stepped.map((m) => m.key)).toEqual(ms.map((m) => m.key));
    // دورات إتقان متعددة دفعة واحدة
    const big = milestonesBetween(0, 306000 + 9180 * 3 + 5);
    expect(big.filter((m) => m.kind === 'mastery').length).toBe(3);
    expect(progressFromXp(306000 + 9180 * 3 + 5).barXp).toBe(5);
  });

  it('10: عند 510 XP/يوم وشهر30 يومًا: الجواهر تسمح 4 ثم 3 ثم 2 ثم 1 بطل', () => {
    const month = 510 * 30;
    let balance = 0;
    const bought: number[] = [];
    const leftovers: number[] = [];
    for (let m = 1; m <= 20; m++) {
      balance += gemsEarnedAtXp(month * m) - gemsEarnedAtXp(month * (m - 1));
      const n = Math.floor(balance / 100);
      balance -= n * 100;
      bought.push(n);
      leftovers.push(balance);
    }
    expect(bought.slice(0, 5)).toEqual([4, 3, 2, 1, 1]);
    expect(leftovers.slice(0, 5)).toEqual([20, 20, 20, 40, 20]);
    expect(gemsEarnedAtXp(month) - 0).toBe(420);
    expect(gemsEarnedAtXp(month * 2) - gemsEarnedAtXp(month)).toBe(300);
    expect(gemsEarnedAtXp(month * 3) - gemsEarnedAtXp(month * 2)).toBe(200);
    expect(gemsEarnedAtXp(month * 4) - gemsEarnedAtXp(month * 3)).toBe(120);
    expect(gemsEarnedAtXp(month * 5) - gemsEarnedAtXp(month * 4)).toBe(80);
    // أيام الشراء في الشهر الأول تقريبًا 6 و12 و18 و24
    const days = [6, 12, 18, 24].map((d) => gemsEarnedAtXp(510 * d));
    expect(days).toEqual([100, 200, 300, 400]);
    expect(gemsEarnedAtXp(510 * 5)).toBe(0);
    // من الشهر 4 إلى 20: بطل واحد تقريبًا كل شهر مع الترحيل
    expect(bought.slice(3, 20)).toEqual(Array(17).fill(1));
  });
});

describe('المستوى التجميلي', () => {
  it('العتبات 0/20/100/250/600', () => {
    expect([0, 19, 20, 99, 100, 249, 250, 599, 600, 10000].map(cosmeticLevel)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });
});
