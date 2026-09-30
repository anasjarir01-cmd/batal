// محرك القتال النقي. لا يعتمد على الواجهة أو المؤقتات أو الصوت: كل الحسابات هنا،
// والعرض يستهلك سجل الأحداث فقط. الحالة تُنسخ قبل التعديل فلا تتغير المدخلات.
import { CATALOG } from '../../catalog';
import type { AbilityDef, BossDef, Effect, HeroDef } from '../../catalog/types';
import { ROLE_SLOT_ORDER } from '../../catalog/types';
import { stream } from '../rng';
import type {
  BattleEvent,
  BattleEventBody,
  BattleState,
  BoardSnapshot,
  BossAction,
  BossUnit,
  ExecutionRecord,
  HeroUnit,
  PlannedCard,
  ShieldState,
  TimedValue,
  UnitRef,
} from './types';

export const ENERGY_PER_ROUND = 7;
export const HAND_SIZE = 8;
export const PLAN_SLOTS = 3;
export const TEAM_SIZE = 5;
export const BOSS_ACTIONS_PER_ROUND = 3;

export interface EngineContent {
  ability(id: string): AbilityDef;
  hero(id: string): HeroDef;
  boss(id: string): BossDef;
}

export const defaultContent: EngineContent = {
  ability(id) {
    const a = CATALOG.abilities.get(id);
    if (!a) throw new Error(`قدرة غير معروفة ${id}`);
    return a;
  },
  hero(id) {
    const h = CATALOG.heroById.get(id);
    if (!h) throw new Error(`بطل غير معروف ${id}`);
    return h;
  },
  boss(id) {
    const b = CATALOG.bossById.get(id);
    if (!b) throw new Error(`زعيم غير معروف ${id}`);
    return b;
  },
};

// ————————————————— تشكيل الفريق —————————————————

/**
 * يوزع خمسة أبطال مختلفين على خانات الأدوار الثابتة (المحارب، الساحر، القاتل، المعالج، المساند).
 * أول مختار من كل دور يأخذ خانته، والباقون يملؤون الخانات الخالية بالترتيب نفسه وبترتيب اختيارهم.
 */
export function assignSlots(selectedHeroIds: string[], content: EngineContent = defaultContent): string[] {
  if (selectedHeroIds.length !== TEAM_SIZE) throw new Error('يلزم اختيار خمسة أبطال');
  if (new Set(selectedHeroIds).size !== TEAM_SIZE) throw new Error('لا يمكن تكرار نفس البطل');
  const slots: Array<string | null> = Array(TEAM_SIZE).fill(null);
  const leftovers: string[] = [];
  for (const id of selectedHeroIds) {
    const role = content.hero(id).role;
    const idx = ROLE_SLOT_ORDER.indexOf(role);
    if (idx >= 0 && slots[idx] === null) slots[idx] = id;
    else leftovers.push(id);
  }
  for (const id of leftovers) {
    const free = slots.indexOf(null);
    slots[free] = id;
  }
  return slots as string[];
}

/** يختار زعيمين مختلفين عشوائيًا من القائمة المؤهلة (أو المتاح إن كان أقل). */
export function rollBossCandidates(eligibleBossIds: string[], seed: string): string[] {
  const unique = Array.from(new Set(eligibleBossIds));
  const rng = stream(seed, 'roulette');
  return rng.shuffle(unique).slice(0, Math.min(2, unique.length));
}

// ————————————————— إنشاء المعركة —————————————————

export function createBattle(
  params: { battleId: string; seed: string; bossId: string; teamHeroIds: string[] },
  content: EngineContent = defaultContent,
): BattleState {
  const { battleId, seed, bossId, teamHeroIds } = params;
  if (teamHeroIds.length !== TEAM_SIZE || new Set(teamHeroIds).size !== TEAM_SIZE) throw new Error('فريق غير صالح');
  const bossDef = content.boss(bossId);
  if (bossDef.abilityIds.length !== 9) throw new Error('زعيم بلا تسع قدرات');
  const heroes: HeroUnit[] = teamHeroIds.map((id, slot) => {
    const h = content.hero(id);
    return { slot, heroId: id, role: h.role, maxHp: h.maxHp, hp: h.maxHp };
  });
  const cards: BattleState['cards'] = {};
  heroes.forEach((u) => {
    for (const abilityId of content.hero(u.heroId).abilityIds) {
      const id = `${u.heroId}:${abilityId}`;
      cards[id] = { id, abilityId, ownerSlot: u.slot };
    }
  });
  const deck = stream(seed, 'player-shuffle', 0).shuffle(Object.keys(cards));
  const state: BattleState = {
    v: 1,
    battleId,
    seed,
    bossId,
    teamHeroIds: teamHeroIds.slice(),
    heroes,
    boss: { bossId, maxHp: bossDef.maxHp, hp: bossDef.maxHp },
    round: 1,
    phase: 1,
    phase2Pending: false,
    energy: ENERGY_PER_ROUND,
    cards,
    draw: deck.slice(HAND_SIZE),
    hand: deck.slice(0, HAND_SIZE),
    discard: [],
    removed: [],
    playerShuffles: 1,
    bossCycle: -1,
    bossOrder: [],
    bossPlan: [],
    bossHistory: [],
    stage: 'planning',
    eventSeq: 0,
  };
  planBossRound(state, content);
  return state;
}

// ————————————————— أدوات مساعدة —————————————————

const clone = <T>(x: T): T => structuredClone(x);

function snapshot(s: BattleState): BoardSnapshot {
  return clone({ round: s.round, phase: s.phase, phase2Pending: s.phase2Pending, heroes: s.heroes, boss: s.boss });
}

function unitOf(s: BattleState, ref: UnitRef): HeroUnit | BossUnit {
  return ref === 'boss' ? s.boss : s.heroes[ref];
}

/** ≥ يستبدل ويجدد، والأقل لا يغير القيمة ولا المدة. */
function applyTimed(cur: TimedValue | undefined, value: number, round: number): { next: TimedValue; applied: boolean } {
  if (!cur || value >= cur.value) return { next: { value, expiresRound: round + 1 }, applied: true };
  return { next: cur, applied: false };
}

function applyShield(unit: HeroUnit | BossUnit, value: number, reflect: number, round: number): boolean {
  const cur = unit.shield;
  if (!cur || value >= cur.value) {
    unit.shield = { value, reflect, expiresRound: round + 1 } satisfies ShieldState;
    return true;
  }
  return false;
}

/** يطبّق ضربة مباشرة على وحدة: الصدّ يمتص أول ضربة غير ثاقبة ثم يزول كله. */
function strike(unit: HeroUnit | BossUnit, amount: number, piercing: boolean): { dealt: number; absorbed: number; reflect: number } {
  if (!piercing && unit.shield) {
    const absorbed = Math.min(amount, unit.shield.value);
    const reflect = unit.shield.reflect;
    unit.shield = undefined;
    return { dealt: amount - absorbed, absorbed, reflect };
  }
  return { dealt: amount, absorbed: 0, reflect: 0 };
}

function clearHeroStatuses(h: HeroUnit) {
  h.shield = h.focus = h.weaken = h.poison = h.bleed = undefined;
}

class EventLog {
  events: BattleEvent[] = [];
  constructor(private s: BattleState) {}
  push(body: BattleEventBody) {
    const seq = ++this.s.eventSeq;
    this.events.push({ ...body, id: `${this.s.battleId}#${seq}`, seq } as BattleEvent);
  }
}

// ————————————————— خطة الزعيم —————————————————

function aliveSlots(s: BattleState): number[] {
  return s.heroes.filter((h) => h.hp > 0).map((h) => h.slot);
}

/** مقارنة نسبة الحياة بأعداد صحيحة (دون أعداد عشرية). */
function ratioCompare(a: HeroUnit, b: HeroUnit): number {
  const d = a.hp * b.maxHp - b.hp * a.maxHp;
  return d !== 0 ? d : a.slot - b.slot;
}

function pickSingleTarget(s: BattleState, bossDef: BossDef, rng: ReturnType<typeof stream>): number[] {
  const alive = s.heroes.filter((h) => h.hp > 0);
  if (!alive.length) return [];
  let pool = alive;
  if (s.phase === 2) {
    if (bossDef.phase2Rule === 'lowest-ratio-two') {
      pool = alive.slice().sort(ratioCompare).slice(0, 2);
    } else if (bossDef.phase2Rule === 'poisoned') {
      const poisoned = alive.filter((h) => h.poison);
      if (poisoned.length) pool = poisoned;
    }
  }
  return [rng.pick(pool).slot];
}

/** يحسب ترتيب حركات الزعيم الثلاث وأهدافها وأماكن الإخفاء من حالة بداية الجولة. */
export function planBossRound(s: BattleState, content: EngineContent = defaultContent): void {
  const bossDef = content.boss(s.bossId);
  const cycle = Math.floor((s.round - 1) / 3);
  if (s.bossCycle !== cycle) {
    s.bossOrder = stream(s.seed, 'boss-deck', cycle).shuffle(bossDef.abilityIds);
    s.bossCycle = cycle;
  }
  const start = ((s.round - 1) % 3) * BOSS_ACTIONS_PER_ROUND;
  const ids = s.bossOrder.slice(start, start + BOSS_ACTIONS_PER_ROUND);
  const hiddenCount = s.round % 3 === 0 ? 2 : 1;
  const hidden = new Set(stream(s.seed, 'boss-hide', s.round).shuffle([0, 1, 2]).slice(0, hiddenCount));
  const tRng = stream(s.seed, 'boss-targets', s.round);
  const alive = aliveSlots(s);
  s.bossPlan = ids.map((abilityId, i): BossAction => {
    const a = content.ability(abilityId);
    let targets: number[] = [];
    switch (a.bossTarget) {
      case 'self':
        targets = [];
        break;
      case 'all':
        targets = alive.slice();
        break;
      case 'double':
        targets = alive.length <= 1 ? alive.slice() : tRng.shuffle(alive).slice(0, 2);
        break;
      case 'single':
      default:
        targets = pickSingleTarget(s, bossDef, tRng);
        break;
    }
    return { abilityId, targets, hidden: hidden.has(i) };
  });
}

// ————————————————— التحقق من خطة اللاعب —————————————————

export function cardCost(s: BattleState, cardId: string, content: EngineContent = defaultContent): number {
  return content.ability(s.cards[cardId].abilityId).cost ?? 0;
}

/** الأهداف القانونية لبطاقة تحتاج اختيار بطل (من حالة بداية الجولة). */
export function legalTargets(s: BattleState, cardId: string, content: EngineContent = defaultContent): number[] {
  const card = s.cards[cardId];
  const a = content.ability(card.abilityId);
  const alive = aliveSlots(s);
  if (a.heroTarget === 'ally-any') return alive;
  if (a.heroTarget === 'ally-other') return alive.filter((x) => x !== card.ownerSlot);
  return [];
}

export function needsTarget(s: BattleState, cardId: string, content: EngineContent = defaultContent): boolean {
  const a = content.ability(s.cards[cardId].abilityId);
  return a.heroTarget === 'ally-any' || a.heroTarget === 'ally-other';
}

/** يعيد رسالة الخطأ أو null إذا كانت الخطة قانونية. */
export function validatePlan(s: BattleState, plan: PlannedCard[], content: EngineContent = defaultContent): string | null {
  if (s.stage !== 'planning' || s.outcome) return 'المعركة ليست في مرحلة التخطيط';
  if (plan.length > PLAN_SLOTS) return 'ثلاث بطاقات كحد أقصى';
  const ids = plan.map((p) => p.cardId);
  if (new Set(ids).size !== ids.length) return 'لا يمكن لعب نفس البطاقة مرتين';
  let cost = 0;
  for (const p of plan) {
    if (!s.hand.includes(p.cardId)) return 'البطاقة ليست في اليد';
    const card = s.cards[p.cardId];
    const owner = s.heroes[card.ownerSlot];
    if (!owner || owner.hp <= 0) return 'صاحب البطاقة ساقط';
    const a = content.ability(card.abilityId);
    cost += a.cost ?? 0;
    if (needsTarget(s, p.cardId, content)) {
      if (p.target === undefined) return `القدرة ${a.name} تحتاج هدفًا`;
      if (!legalTargets(s, p.cardId, content).includes(p.target)) return `هدف غير قانوني لـ${a.name}`;
    } else if (p.target !== undefined) return `القدرة ${a.name} لا تحتاج هدفًا`;
  }
  if (cost > s.energy) return `الطاقة لا تكفي (${cost}/${s.energy})`;
  return null;
}

// ————————————————— حل حركة واحدة —————————————————

interface Ctx {
  s: BattleState;
  log: EventLog;
  content: EngineContent;
}

function playerEffectTargets(ctx: Ctx, e: Effect, ownerSlot: number, chosen: number | undefined, aliveAtStart: Set<number>, ability: AbilityDef): UnitRef[] {
  switch (e.target) {
    case 'boss':
      return ['boss'];
    case 'owner':
      return aliveAtStart.has(ownerSlot) ? [ownerSlot] : [];
    case 'chosen': {
      if (chosen === undefined) return [];
      if (ability.heroTarget === 'ally-other' && chosen === ownerSlot) {
        ctx.log.push({ t: 'effectFailed', unit: chosen, reason: 'self-forbidden', source: ability.id });
        return [];
      }
      if (!aliveAtStart.has(chosen)) {
        ctx.log.push({ t: 'effectFailed', unit: chosen, reason: 'dead', source: ability.id });
        return [];
      }
      return [chosen];
    }
    case 'allHeroes':
      return [...aliveAtStart].sort((a, b) => a - b);
    case 'otherHeroes':
      return [...aliveAtStart].filter((x) => x !== ownerSlot).sort((a, b) => a - b);
    default:
      return [];
  }
}

function bossEffectTargets(e: Effect, action: BossAction, aliveAtStart: Set<number>): UnitRef[] {
  if (e.target === 'owner') return ['boss'];
  if (e.target === 'bossTargets') return action.targets.filter((t) => aliveAtStart.has(t));
  return [];
}

type Side = { kind: 'player'; ability: AbilityDef; ownerSlot: number; chosen?: number } | { kind: 'boss'; ability: AbilityDef; action: BossAction };

function targetsFor(ctx: Ctx, side: Side, e: Effect, aliveAtStart: Set<number>): UnitRef[] {
  return side.kind === 'player'
    ? playerEffectTargets(ctx, e, side.ownerSlot, side.chosen, aliveAtStart, side.ability)
    : bossEffectTargets(e, side.action, aliveAtStart);
}

function resolveSlot(ctx: Ctx, slot: number, planned: PlannedCard | undefined, bossAction: BossAction): void {
  const { s, log, content } = ctx;
  // A — تثبيت المشاركين
  if (s.outcome) return;
  const round = s.round;
  const aliveAtStart = new Set(aliveSlots(s));
  const startHp = new Map<UnitRef, number>([['boss', s.boss.hp], ...s.heroes.map((h) => [h.slot, h.hp] as [UnitRef, number])]);

  const sides: Side[] = [];
  let playerInfo: BattleEventBody & { t: 'slotStart' };
  const bossAbility = content.ability(bossAction.abilityId);
  if (planned) {
    const card = s.cards[planned.cardId];
    const ability = content.ability(card.abilityId);
    const active = aliveAtStart.has(card.ownerSlot);
    playerInfo = {
      t: 'slotStart',
      slot,
      player: { cardId: card.id, abilityId: card.abilityId, ownerSlot: card.ownerSlot, target: planned.target, cancelled: !active },
      boss: { abilityId: bossAction.abilityId, targets: bossAction.targets.slice(), wasHidden: bossAction.hidden },
    };
    if (active) sides.push({ kind: 'player', ability, ownerSlot: card.ownerSlot, chosen: planned.target });
  } else {
    playerInfo = { t: 'slotStart', slot, boss: { abilityId: bossAction.abilityId, targets: bossAction.targets.slice(), wasHidden: bossAction.hidden } };
  }
  log.push(playerInfo);
  if (planned && playerInfo.player?.cancelled) log.push({ t: 'cardCancelled', cardId: planned.cardId });
  sides.push({ kind: 'boss', ability: bossAbility, action: bossAction });
  s.bossHistory.push({ round, slot, abilityId: bossAction.abilityId });

  const heal = new Map<UnitRef, number>();
  const dmg = new Map<UnitRef, number>();
  const add = (m: Map<UnitRef, number>, k: UnitRef, v: number) => m.set(k, (m.get(k) ?? 0) + v);

  // B — الحماية والعلاج والتطهير الفوري
  for (const side of sides) {
    for (const e of side.ability.effects) {
      if (e.type !== 'shield') continue;
      for (const ref of targetsFor(ctx, side, e, aliveAtStart)) {
        const u = unitOf(s, ref);
        const applied = applyShield(u, e.amount, e.reflect ?? 0, round);
        log.push({ t: 'shield', unit: ref, value: e.amount, reflect: e.reflect ?? 0, applied, source: side.ability.id });
      }
    }
  }
  for (const side of sides) {
    for (const e of side.ability.effects) {
      if (e.type !== 'heal') continue;
      for (const ref of targetsFor(ctx, side, e, aliveAtStart)) {
        add(heal, ref, e.amount);
        log.push({ t: 'heal', unit: ref, amount: e.amount, source: side.ability.id });
      }
    }
  }
  for (const side of sides) {
    for (const e of side.ability.effects) {
      if (e.type !== 'cleanse') continue;
      for (const ref of targetsFor(ctx, side, e, aliveAtStart)) {
        const u = unitOf(s, ref) as HeroUnit & BossUnit;
        const removed: Array<'poison' | 'bleed' | 'burn' | 'weaken'> = [];
        for (const st of e.remove) {
          if (u[st]) {
            u[st] = undefined;
            removed.push(st);
          }
        }
        log.push({ t: 'cleanse', unit: ref, removed, source: side.ability.id });
      }
    }
  }
  for (const side of sides) {
    for (const e of side.ability.effects) {
      if (e.type !== 'removeBarrier') continue;
      for (const ref of targetsFor(ctx, side, e, aliveAtStart)) {
        const u = unitOf(s, ref);
        if (u.shield) {
          log.push({ t: 'barrierRemoved', unit: ref, value: u.shield.value, reflect: u.shield.reflect, source: side.ability.id });
          u.shield = undefined;
        }
      }
    }
  }

  // C — حساب الضرر دون إعلان الموت مبكرًا
  for (const side of sides) {
    for (const e of side.ability.effects) {
      if (e.type !== 'damage') continue;
      const targets = targetsFor(ctx, side, e, aliveAtStart);
      if (!targets.length) continue; // لا هجوم مباشر مؤهل: لا يُستهلك شيء
      if (side.kind === 'player') {
        const owner = s.heroes[side.ownerSlot];
        for (const ref of targets) {
          const target = unitOf(s, ref) as BossUnit;
          let bonus = 0;
          if (e.bonus?.kind === 'ifBossBurning' && target.burn) {
            bonus = e.bonus.amount;
            if (e.bonus.consumeBurn) {
              target.burn = undefined;
              log.push({ t: 'consumed', unit: ref, status: 'burn' });
            }
          }
          const focus = owner.focus?.value ?? 0;
          if (owner.focus) {
            owner.focus = undefined;
            log.push({ t: 'consumed', unit: owner.slot, status: 'focus' });
          }
          let mark = 0;
          if (target.mark) {
            mark = e.markBonusOverride ?? target.mark.value;
            target.mark = undefined;
            log.push({ t: 'consumed', unit: ref, status: 'mark' });
          }
          let expose = 0;
          if (target.expose) {
            expose = target.expose.bonus;
            target.expose = target.expose.charges > 1 ? { ...target.expose, charges: target.expose.charges - 1 } : undefined;
            log.push({ t: 'consumed', unit: ref, status: 'expose' });
          }
          const weaken = owner.weaken?.value ?? 0;
          if (owner.weaken) {
            owner.weaken = undefined;
            log.push({ t: 'consumed', unit: owner.slot, status: 'weaken' });
          }
          const raw = Math.max(0, e.amount + bonus + focus + mark + expose - weaken);
          const r = strike(target, raw, !!e.piercing);
          add(dmg, ref, r.dealt);
          log.push({ t: 'hit', from: owner.slot, to: ref, source: side.ability.id, raw, absorbed: r.absorbed, dealt: r.dealt, piercing: !!e.piercing, bonus, focus, mark, expose, weaken });
          if (r.reflect > 0) {
            add(dmg, owner.slot, r.reflect);
            log.push({ t: 'reflect', from: ref, to: owner.slot, amount: r.reflect });
          }
        }
      } else {
        const boss = s.boss;
        const weaken = boss.weaken?.value ?? 0;
        let lifestealDone = false;
        for (const ref of targets) {
          const target = unitOf(s, ref) as HeroUnit;
          let bonus = 0;
          if (e.bonus?.kind === 'ifTargetShielded' && target.shield) bonus = e.bonus.amount;
          if (e.bonus?.kind === 'ifTargetPoisoned' && target.poison) bonus = e.bonus.amount;
          const raw = Math.max(0, e.amount + bonus - weaken);
          const r = strike(target, raw, !!e.piercing);
          add(dmg, ref, r.dealt);
          log.push({ t: 'hit', from: 'boss', to: ref, source: side.ability.id, raw, absorbed: r.absorbed, dealt: r.dealt, piercing: !!e.piercing, bonus, focus: 0, mark: 0, expose: 0, weaken });
          if (r.reflect > 0) {
            add(dmg, 'boss', r.reflect);
            log.push({ t: 'reflect', from: ref, to: 'boss', amount: r.reflect });
          }
          if (e.healOwnerOnHit && r.dealt > 0 && !lifestealDone) {
            lifestealDone = true;
            add(heal, 'boss', e.healOwnerOnHit);
            log.push({ t: 'heal', unit: 'boss', amount: e.healOwnerOnHit, source: side.ability.id });
          }
        }
        if (boss.weaken) {
          boss.weaken = undefined; // يُستهلك مرة واحدة بعد حساب كل الأهداف
          log.push({ t: 'consumed', unit: 'boss', status: 'weaken' });
        }
      }
    }
  }

  // D — تحديث الحياة معًا
  const fellNow: number[] = [];
  const update = (ref: UnitRef) => {
    const u = unitOf(s, ref);
    const from = startHp.get(ref) ?? u.hp;
    if (from <= 0) return;
    const to = Math.min(u.maxHp, Math.max(0, from + (heal.get(ref) ?? 0) - (dmg.get(ref) ?? 0)));
    u.hp = to;
    if (to !== from) log.push({ t: 'hp', unit: ref, from, to });
    if (to === 0) {
      log.push({ t: 'fell', unit: ref });
      if (ref !== 'boss') fellNow.push(ref);
    }
  };
  update('boss');
  for (const h of s.heroes) update(h.slot);

  // E — الآثار الجديدة بعد الضرر، على أهداف ما زالت حية
  const aliveNow = (ref: UnitRef) => unitOf(s, ref).hp > 0;
  const postOrder: Array<Effect['type']> = ['dot', 'huntMark', 'expose', 'focus', 'weaken'];
  for (const type of postOrder) {
    for (const side of sides) {
      for (const e of side.ability.effects) {
        if (e.type !== type) continue;
        for (const ref of targetsFor(ctx, side, e, aliveAtStart)) {
          if (!aliveNow(ref)) continue;
          const u = unitOf(s, ref) as HeroUnit & BossUnit;
          if (e.type === 'dot') {
            const cur = u[e.status];
            u[e.status] = { amount: Math.max(cur?.amount ?? 0, e.amount), ticks: e.ticks };
            log.push({ t: 'status', unit: ref, status: e.status, value: e.amount, applied: true, source: side.ability.id });
          } else if (e.type === 'huntMark') {
            const r = applyTimed(u.mark, e.amount, round);
            u.mark = r.next;
            log.push({ t: 'status', unit: ref, status: 'mark', value: e.amount, applied: r.applied, source: side.ability.id });
          } else if (e.type === 'expose') {
            u.expose = { bonus: Math.max(u.expose?.bonus ?? 0, e.amount), charges: e.charges, expiresRound: round + 1 };
            log.push({ t: 'status', unit: ref, status: 'expose', value: e.amount, applied: true, source: side.ability.id });
          } else if (e.type === 'focus') {
            const r = applyTimed(u.focus, e.amount, round);
            u.focus = r.next;
            log.push({ t: 'status', unit: ref, status: 'focus', value: e.amount, applied: r.applied, source: side.ability.id });
          } else if (e.type === 'weaken') {
            const r = applyTimed(u.weaken, e.amount, round);
            u.weaken = r.next;
            log.push({ t: 'status', unit: ref, status: 'weaken', value: e.amount, applied: r.applied, source: side.ability.id });
          }
        }
      }
    }
  }

  // تنظيف الساقطين وبطاقاتهم
  for (const slotIdx of fellNow) removeFallen(s, slotIdx);
  checkOutcome(ctx);
  if (!s.outcome) checkPhase2(ctx);
}

function removeFallen(s: BattleState, slot: number) {
  clearHeroStatuses(s.heroes[slot]);
  const isTheirs = (id: string) => s.cards[id].ownerSlot === slot;
  for (const zone of ['hand', 'draw', 'discard'] as const) {
    const gone = s[zone].filter(isTheirs);
    if (gone.length) {
      s[zone] = s[zone].filter((id) => !isTheirs(id));
      s.removed.push(...gone);
    }
  }
}

function checkOutcome(ctx: Ctx) {
  const { s, log } = ctx;
  const bossDead = s.boss.hp <= 0;
  const heroesDead = s.heroes.every((h) => h.hp <= 0);
  if (bossDead && heroesDead) s.outcome = 'draw';
  else if (bossDead) s.outcome = 'victory';
  else if (heroesDead) s.outcome = 'defeat';
  if (s.outcome) {
    s.stage = 'ended';
    log.push({ t: 'outcome', outcome: s.outcome });
  }
}

function checkPhase2(ctx: Ctx) {
  const { s, log } = ctx;
  if (s.phase === 1 && !s.phase2Pending && s.boss.hp * 2 <= s.boss.maxHp) {
    s.phase2Pending = true;
    log.push({ t: 'phase2Pending' });
  }
}

// ————————————————— نهاية الجولة وبداية التالية —————————————————

function endOfRound(ctx: Ctx) {
  const { s, log } = ctx;
  if (s.outcome) return;
  const round = s.round;
  // 1) نبضات الاحتراق/السم/النزيف من snapshot واحد
  const ticks = new Map<UnitRef, number>();
  const units: Array<[UnitRef, HeroUnit | BossUnit]> = [['boss', s.boss], ...s.heroes.map((h) => [h.slot, h] as [UnitRef, HeroUnit])];
  for (const [ref, u] of units) {
    if (u.hp <= 0) continue;
    const kinds = ref === 'boss' ? (['burn'] as const) : (['poison', 'bleed'] as const);
    for (const k of kinds) {
      const d = (u as HeroUnit & BossUnit)[k];
      if (d && d.ticks > 0) {
        ticks.set(ref, (ticks.get(ref) ?? 0) + d.amount);
        log.push({ t: 'dotTick', unit: ref, status: k, amount: d.amount });
      }
    }
  }
  const fellNow: number[] = [];
  for (const [ref, u] of units) {
    const t = ticks.get(ref);
    if (!t || u.hp <= 0) continue;
    const from = u.hp;
    u.hp = Math.max(0, from - t);
    log.push({ t: 'hp', unit: ref, from, to: u.hp });
    if (u.hp === 0) {
      log.push({ t: 'fell', unit: ref });
      if (ref !== 'boss') fellNow.push(ref);
    }
  }
  // إنقاص المدد
  for (const [ref, u] of units) {
    const any = u as HeroUnit & BossUnit;
    for (const k of ['burn', 'poison', 'bleed'] as const) {
      const d = any[k];
      if (!d) continue;
      const left = d.ticks - 1;
      if (left <= 0) {
        any[k] = undefined;
        log.push({ t: 'expired', unit: ref, status: k });
      } else any[k] = { ...d, ticks: left };
    }
    // 2) إزالة الآثار المنتهية بنهاية هذه الجولة
    for (const k of ['shield', 'focus', 'weaken', 'mark', 'expose'] as const) {
      const st = any[k] as { expiresRound: number } | undefined;
      if (st && st.expiresRound <= round) {
        any[k] = undefined;
        log.push({ t: 'expired', unit: ref, status: k });
      }
    }
  }
  for (const slot of fellNow) removeFallen(s, slot);
  // 3) النتيجة وعتبة المرحلة الثانية
  checkOutcome(ctx);
  if (!s.outcome) checkPhase2(ctx);
  log.push({ t: 'roundEnd', round, snapshot: snapshot(s) });
}

function refillHand(ctx: Ctx) {
  const { s, log } = ctx;
  let count = 0;
  let reshuffled = false;
  while (s.hand.length < HAND_SIZE) {
    if (!s.draw.length) {
      if (!s.discard.length) break;
      s.draw = stream(s.seed, 'player-shuffle', s.playerShuffles).shuffle(s.discard);
      s.playerShuffles += 1;
      s.discard = [];
      reshuffled = true;
    }
    s.hand.push(s.draw.shift() as string);
    count++;
  }
  log.push({ t: 'drawCards', count, reshuffled });
}

function beginNextRound(ctx: Ctx) {
  const { s, log, content } = ctx;
  s.round += 1;
  if (s.phase2Pending) {
    s.phase = 2;
    s.phase2Pending = false;
    log.push({ t: 'phase2', round: s.round });
  }
  refillHand(ctx);
  s.energy = ENERGY_PER_ROUND;
  planBossRound(s, content);
  log.push({ t: 'roundStart', round: s.round });
}

// ————————————————— تنفيذ جولة كاملة —————————————————

export interface RoundResult {
  state: BattleState;
  record: ExecutionRecord;
}

/**
 * ينفذ الجولة كاملة (الخانات الثلاث ثم نهاية الجولة ثم تجهيز التالية) ويعيد حالة جديدة وسجل أحداث.
 * خطة فارغة = تمرير الجولة.
 */
export function executeRound(input: BattleState, plan: PlannedCard[], content: EngineContent = defaultContent): RoundResult {
  const err = validatePlan(input, plan, content);
  if (err) throw new Error(err);
  const before = clone(input);
  const s = clone(input);
  const log = new EventLog(s);
  const ctx: Ctx = { s, log, content };
  // البطاقات المختارة تخرج من اليد إلى منطقة التنفيذ
  const inPlay = plan.map((p) => p.cardId);
  s.hand = s.hand.filter((id) => !inPlay.includes(id));
  const bossPlan = s.bossPlan.slice();
  for (let slot = 0; slot < PLAN_SLOTS; slot++) {
    if (s.outcome) break;
    const planned = plan[slot];
    resolveSlot(ctx, slot, planned, bossPlan[slot]);
    if (planned) {
      const owner = s.heroes[s.cards[planned.cardId].ownerSlot];
      // تُستهلك البطاقة: للمستعمل، أو تُزال إن سقط صاحبها
      if (owner.hp > 0) s.discard.push(planned.cardId);
      else s.removed.push(planned.cardId);
      inPlay.splice(inPlay.indexOf(planned.cardId), 1);
    }
    log.push({ t: 'slotEnd', slot, snapshot: snapshot(s) });
  }
  // بطاقات لم تُنفذ لأن المعركة انتهت مبكرًا
  for (const id of inPlay) {
    if (s.heroes[s.cards[id].ownerSlot].hp > 0) s.discard.push(id);
    else s.removed.push(id);
  }
  if (!s.outcome) endOfRound(ctx);
  if (!s.outcome) beginNextRound(ctx);
  const record: ExecutionRecord = { id: `${s.battleId}:r${input.round}`, round: input.round, plan: clone(plan), before, events: log.events };
  return { state: s, record };
}

export function retreat(input: BattleState): BattleState {
  const s = clone(input);
  if (!s.outcome) {
    s.outcome = 'retreat';
    s.stage = 'ended';
  }
  return s;
}

/** معاينة حية لضربة بطاقة لاعب (دون تنفيذها) لعرضها في نافذة التكبير. */
export function previewPlayerHit(s: BattleState, cardId: string, content: EngineContent = defaultContent) {
  const card = s.cards[cardId];
  const a = content.ability(card.abilityId);
  const owner = s.heroes[card.ownerSlot];
  const dmg = a.effects.find((e) => e.type === 'damage');
  if (!dmg || dmg.type !== 'damage') return null;
  const bonus = dmg.bonus?.kind === 'ifBossBurning' && s.boss.burn ? dmg.bonus.amount : 0;
  const focus = owner.focus?.value ?? 0;
  const mark = s.boss.mark ? (dmg.markBonusOverride ?? s.boss.mark.value) : 0;
  const expose = s.boss.expose?.bonus ?? 0;
  const weaken = owner.weaken?.value ?? 0;
  const raw = Math.max(0, dmg.amount + bonus + focus + mark + expose - weaken);
  const shield = !dmg.piercing && s.boss.shield ? s.boss.shield.value : 0;
  return { base: dmg.amount, bonus, focus, mark, expose, weaken, raw, shield, piercing: !!dmg.piercing, reflect: !dmg.piercing ? (s.boss.shield?.reflect ?? 0) : 0 };
}

/** عدد بطاقات الرزمة في كل المناطق (للتحقق من الثوابت). */
export function deckZoneTotal(s: BattleState): number {
  return s.draw.length + s.hand.length + s.discard.length;
}

export function isHeroAlive(s: BattleState, slot: number): boolean {
  return s.heroes[slot]?.hp > 0;
}
