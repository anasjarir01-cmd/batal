import type { Difficulty, Recurrence } from '../engine/economy';
import type { BattleState, ExecutionRecord } from '../engine/battle/types';

export interface Profile {
  id: 'main';
  xp: number;
  coins: number;
  gems: number;
  coinsEarned: number;
  coinsSpent: number;
  gemsEarned: number;
  gemsSpent: number;
  createdAt: number;
  updatedAt: number;
}

export interface OwnedHero {
  heroId: string;
  wins: number;
  acquiredAt: number;
  source: 'starter' | 'purchase';
}

export interface UnlockedBoss {
  bossId: string;
  unlockedAt: number;
  source: string; // 'starter' أو مفتاح الاستحقاق
}

export interface BossEntitlement {
  key: string; // rank:r:i
  rank: number;
  index: number;
  earnedAt: number;
  bossId: string | null;
  appliedAt?: number;
}

export interface Challenge {
  id: string;
  name: string;
  description: string;
  imageId: string | null;
  difficulty: Difficulty;
  customXp?: number;
  customCoins?: number;
  recurrence: Recurrence;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  order: number;
}

export interface Completion {
  key: string; // challengeId|dateKey أو challengeId|once
  challengeId: string;
  kind: Recurrence;
  dateKey: string;
  at: number;
  snapshot: {
    name: string;
    difficulty: Difficulty;
    xp: number;
    coins: number;
    imageId: string | null;
    recurrence: Recurrence;
  };
}

export interface Reward {
  id: string;
  name: string;
  description: string;
  imageId: string | null;
  price: number;
  recurrence: 'repeat' | 'once';
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  order: number;
}

export interface Purchase {
  id: string; // رمز العملية الفريد
  rewardId: string;
  at: number;
  snapshot: { name: string; price: number; imageId: string | null; recurrence: 'repeat' | 'once' };
}

export type LedgerType =
  | 'challenge-complete'
  | 'level-up'
  | 'rank-complete'
  | 'mastery'
  | 'boss-entitlement'
  | 'boss-unlock'
  | 'reward-purchase'
  | 'hero-purchase'
  | 'battle-result'
  | 'cosmetic-level'
  | 'backup-restore';

export interface LedgerEntry {
  id: string;
  type: LedgerType;
  at: number;
  data: Record<string, unknown>;
}

export interface StoredBlob {
  id: string;
  data: ArrayBuffer;
  type: string;
  name: string;
  size: number;
  purpose: 'challenge' | 'reward' | 'music';
  createdAt: number;
}

export interface Track {
  id: string;
  blobId: string;
  name: string;
  type: string;
  size: number;
  order: number;
  addedAt: number;
}

export interface Settings {
  sfxVolume: number;
  sfxMuted: boolean;
  musicVolume: number;
  musicLoop: boolean;
  reduceMotion: 'system' | 'on' | 'off';
  battleSpeed: 1 | 2;
}

export const DEFAULT_SETTINGS: Settings = {
  sfxVolume: 0.7,
  sfxMuted: false,
  musicVolume: 0.6,
  musicLoop: true,
  reduceMotion: 'system',
  battleSpeed: 1,
};

export interface BattlePrep {
  prepId: string;
  teamHeroIds: string[]; // مرتبة على الخانات
  seed: string;
  candidates: string[];
  createdAt: number;
}

export interface BattleRecord {
  id: 'current';
  rev: number;
  prep?: BattlePrep;
  state?: BattleState;
  execution?: ExecutionRecord & { cursor: number };
  settled?: { battleId: string; outcome: string; winners: string[]; levelUps: Array<{ heroId: string; level: number }>; rounds: number };
}

export interface Notice {
  id: string;
  at: number;
  kind: 'level' | 'rank' | 'mastery' | 'boss-unlock' | 'cosmetic' | 'hero';
  data: Record<string, unknown>;
}

export interface MusicPosition {
  trackId: string;
  time: number;
}
