import type { Role } from '../../catalog/types';

export interface ShieldState {
  value: number;
  reflect: number;
  /** ينتهي بنهاية هذه الجولة إن لم يُستهلك. */
  expiresRound: number;
}
export interface TimedValue {
  value: number;
  expiresRound: number;
}
export interface DotState {
  amount: number;
  /** عدد نبضات نهاية الجولة المتبقية. */
  ticks: number;
}
export interface ExposeState {
  bonus: number;
  charges: number;
  expiresRound: number;
}

export interface HeroUnit {
  /** خانة ثابتة 0..4 من اليمين إلى اليسار؛ لا تتغير بالموت. */
  slot: number;
  heroId: string;
  role: Role;
  maxHp: number;
  hp: number;
  shield?: ShieldState;
  focus?: TimedValue;
  /** إضعاف الهجوم المباشر التالي لهذا البطل. */
  weaken?: TimedValue;
  poison?: DotState;
  bleed?: DotState;
}

export interface BossUnit {
  bossId: string;
  maxHp: number;
  hp: number;
  shield?: ShieldState;
  /** إضعاف الهجوم المباشر التالي للزعيم (لكل هدف). */
  weaken?: TimedValue;
  burn?: DotState;
  mark?: TimedValue;
  expose?: ExposeState;
}

export interface CardInstance {
  id: string;
  abilityId: string;
  ownerSlot: number;
}

export interface PlannedCard {
  cardId: string;
  /** خانة البطل المختار عند الحاجة. */
  target?: number;
}

export interface BossAction {
  abilityId: string;
  /** خانات الأبطال المستهدفة، محسوبة من حالة بداية الجولة. */
  targets: number[];
  hidden: boolean;
}

export type Outcome = 'victory' | 'defeat' | 'draw' | 'retreat';

export interface BattleState {
  v: 1;
  battleId: string;
  seed: string;
  bossId: string;
  teamHeroIds: string[];
  heroes: HeroUnit[];
  boss: BossUnit;
  round: number;
  phase: 1 | 2;
  phase2Pending: boolean;
  energy: number;
  cards: Record<string, CardInstance>;
  draw: string[];
  hand: string[];
  discard: string[];
  removed: string[];
  playerShuffles: number;
  bossCycle: number;
  bossOrder: string[];
  bossPlan: BossAction[];
  bossHistory: Array<{ round: number; slot: number; abilityId: string }>;
  stage: 'planning' | 'ended';
  outcome?: Outcome;
  eventSeq: number;
}

export type UnitRef = 'boss' | number;

export interface BoardSnapshot {
  round: number;
  phase: 1 | 2;
  phase2Pending: boolean;
  heroes: HeroUnit[];
  boss: BossUnit;
}

export type StatusName = 'shield' | 'burn' | 'poison' | 'bleed' | 'mark' | 'expose' | 'focus' | 'weaken' | 'reflect';

export type BattleEventBody =
  | { t: 'slotStart'; slot: number; player?: { cardId: string; abilityId: string; ownerSlot: number; target?: number; cancelled?: boolean }; boss: { abilityId: string; targets: number[]; wasHidden: boolean } }
  | { t: 'shield'; unit: UnitRef; value: number; reflect: number; applied: boolean; source: string }
  | { t: 'effectFailed'; unit: UnitRef; reason: 'dead' | 'self-forbidden'; source: string }
  | { t: 'cleanse'; unit: UnitRef; removed: StatusName[]; source: string }
  | { t: 'barrierRemoved'; unit: UnitRef; value: number; reflect: number; source: string }
  | { t: 'hit'; from: UnitRef; to: UnitRef; source: string; raw: number; absorbed: number; dealt: number; piercing: boolean; bonus: number; focus: number; mark: number; expose: number; weaken: number }
  | { t: 'reflect'; from: UnitRef; to: UnitRef; amount: number }
  | { t: 'heal'; unit: UnitRef; amount: number; source: string }
  | { t: 'hp'; unit: UnitRef; from: number; to: number }
  | { t: 'fell'; unit: UnitRef }
  | { t: 'status'; unit: UnitRef; status: StatusName; value: number; applied: boolean; source: string }
  | { t: 'consumed'; unit: UnitRef; status: StatusName }
  | { t: 'dotTick'; unit: UnitRef; status: 'burn' | 'poison' | 'bleed'; amount: number }
  | { t: 'expired'; unit: UnitRef; status: StatusName }
  | { t: 'cardCancelled'; cardId: string }
  | { t: 'slotEnd'; slot: number; snapshot: BoardSnapshot }
  | { t: 'roundEnd'; round: number; snapshot: BoardSnapshot }
  | { t: 'phase2Pending' }
  | { t: 'phase2'; round: number }
  | { t: 'outcome'; outcome: Outcome }
  | { t: 'drawCards'; count: number; reshuffled: boolean }
  | { t: 'roundStart'; round: number };

export type BattleEvent = BattleEventBody & { id: string; seq: number };

export interface ExecutionRecord {
  /** معرّف فريد للتنفيذ: battleId + الجولة. */
  id: string;
  round: number;
  plan: PlannedCard[];
  before: BattleState;
  events: BattleEvent[];
}
