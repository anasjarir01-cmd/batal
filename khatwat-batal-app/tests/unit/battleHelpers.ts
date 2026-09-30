// أدوات اختبار القتال: حالات بداية مستقلة مضبوطة، وحركة زعيم محايدة للاختبار فقط (NOOP) لعزل الخانة.
import type { AbilityDef } from '../../src/catalog/types';
import { createBattle, defaultContent, executeRound, type EngineContent } from '../../src/engine/battle/engine';
import type { BattleEvent, BattleState, BoardSnapshot, BossAction, PlannedCard } from '../../src/engine/battle/types';

const NOOP: AbilityDef = {
  id: 'NOOP',
  ownerId: 'test',
  name: 'حركة اختبار محايدة',
  bossTarget: 'self',
  effects: [],
  targetText: '',
  displayText: '',
  vfxText: '',
  vfx: [],
  image: '',
};

/** محتوى اختبار = الكتالوج الحقيقي + NOOP. لا يدخل NOOP في المحتوى الفعلي للتطبيق. */
export const testContent: EngineContent = {
  ...defaultContent,
  ability(id) {
    return id === 'NOOP' ? NOOP : defaultContent.ability(id);
  },
};

export const TEAM = ['hayato', 'nuba', 'skadi', 'eir', 'zhuge'];
export const SLOT = { hayato: 0, nuba: 1, skadi: 2, eir: 3, zhuge: 4 } as const;

export function battle(bossId: 'fenrir' | 'yorigumo' = 'fenrir', seed = 'test-seed'): BattleState {
  return createBattle({ battleId: 'b-test', seed, bossId, teamHeroIds: TEAM }, testContent);
}

export const noop = (): BossAction => ({ abilityId: 'NOOP', targets: [], hidden: false });
export const act = (abilityId: string, targets: number[] = []): BossAction => ({ abilityId, targets, hidden: false });

/** يضع خطة الزعيم للجولة الحالية (الخانات الفارغة = NOOP). */
export function setBoss(s: BattleState, ...actions: BossAction[]): void {
  s.bossPlan = [0, 1, 2].map((i) => actions[i] ?? noop());
}

/** ينقل البطاقات المطلوبة إلى اليد (من السحب أو المستعمل) مع حفظ عدد البطاقات. */
export function withHand(s: BattleState, cardIds: string[]): void {
  for (const id of cardIds) {
    if (s.hand.includes(id)) continue;
    for (const zone of ['draw', 'discard'] as const) {
      const i = s[zone].indexOf(id);
      if (i >= 0) {
        s[zone].splice(i, 1);
        const out = s.hand.find((h) => !cardIds.includes(h));
        if (s.hand.length >= 8 && out) {
          s.hand.splice(s.hand.indexOf(out), 1);
          s[zone].push(out);
        }
        s.hand.push(id);
      }
    }
  }
}

export const card = (heroId: string, abilityId: string) => `${heroId}:${abilityId}`;

export function run(s: BattleState, plan: PlannedCard[]) {
  const cards = plan.map((p) => p.cardId);
  withHand(s, cards);
  const r = executeRound(s, plan, testContent);
  return { ...r, events: r.record.events };
}

export function slotSnapshot(events: BattleEvent[], slot: number): BoardSnapshot {
  const e = events.find((x) => x.t === 'slotEnd' && x.slot === slot);
  if (!e || e.t !== 'slotEnd') throw new Error(`لا لقطة للخانة ${slot}`);
  return e.snapshot;
}

export function roundEndSnapshot(events: BattleEvent[]): BoardSnapshot {
  const e = events.find((x) => x.t === 'roundEnd');
  if (!e || e.t !== 'roundEnd') throw new Error('لا نهاية جولة');
  return e.snapshot;
}
