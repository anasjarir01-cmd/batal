// تحويل سجل أحداث التنفيذ إلى مجموعات عرض ومؤثرات. العرض يستهلك الأحداث فقط ولا يحسب شيئًا.
import { CATALOG } from '../../catalog';
import type { VfxFamily } from '../../catalog/types';
import type { BattleEvent, BoardSnapshot } from '../../engine/battle/types';
import type { FxSpec } from './Vfx';

export interface PlayGroup {
  kind: 'slot' | 'end' | 'post';
  slot?: number;
  /** فهرس أول حدث وآخر حدث (شامل) في السجل. */
  start: number;
  end: number;
  events: BattleEvent[];
  snapshot?: BoardSnapshot;
}

export function groupEvents(events: BattleEvent[]): PlayGroup[] {
  const groups: PlayGroup[] = [];
  let cur: PlayGroup | null = null;
  events.forEach((e, i) => {
    if (e.t === 'slotStart') {
      cur = { kind: 'slot', slot: e.slot, start: i, end: i, events: [e] };
      groups.push(cur);
      return;
    }
    if (cur && cur.kind === 'slot' && cur.snapshot === undefined) {
      cur.events.push(e);
      cur.end = i;
      if (e.t === 'slotEnd') cur.snapshot = e.snapshot;
      return;
    }
    if (e.t === 'roundStart' || e.t === 'phase2' || e.t === 'drawCards') {
      if (!cur || cur.kind !== 'post') {
        cur = { kind: 'post', start: i, end: i, events: [] };
        groups.push(cur);
      }
    } else if (!cur || cur.kind !== 'end') {
      cur = { kind: 'end', start: i, end: i, events: [] };
      groups.push(cur);
    }
    cur.events.push(e);
    cur.end = i;
    if (e.t === 'roundEnd') cur.snapshot = e.snapshot;
  });
  return groups;
}

const ATTACK_FAMILIES: VfxFamily[] = ['slash', 'claw', 'bite', 'arrow', 'arrow-pierce', 'fire', 'sun', 'quake', 'howl', 'thread'];
const TRAVEL: VfxFamily[] = ['arrow', 'arrow-pierce', 'thread', 'fire'];

function attackFamily(abilityId: string): VfxFamily {
  const a = CATALOG.abilities.get(abilityId);
  return (a?.vfx.find((f) => ATTACK_FAMILIES.includes(f)) ?? 'slash') as VfxFamily;
}

const STATUS_FX: Record<string, { kind: FxSpec['kind']; icon: string; tone: FxSpec['tone'] }> = {
  burn: { kind: 'fire', icon: '🔥', tone: 'burn' },
  poison: { kind: 'poison', icon: '☠', tone: 'poison' },
  bleed: { kind: 'bleed', icon: '🩸', tone: 'bleed' },
  mark: { kind: 'mark', icon: '◎', tone: 'buff' },
  expose: { kind: 'expose', icon: '✦✦', tone: 'buff' },
  focus: { kind: 'buff', icon: '🎯', tone: 'buff' },
  weaken: { kind: 'debuff', icon: '⬇', tone: 'debuff' },
};

export interface SlotFx {
  shields: FxSpec[];
  impact: FxSpec[];
  statuses: FxSpec[];
  sounds: VfxFamily[];
}

export function fxForGroup(g: PlayGroup): SlotFx {
  const out: SlotFx = { shields: [], impact: [], statuses: [], sounds: [] };
  for (const e of g.events) {
    switch (e.t) {
      case 'slotStart': {
        if (e.player && !e.player.cancelled) out.sounds.push(...(CATALOG.abilities.get(e.player.abilityId)?.vfx.slice(0, 1) ?? []));
        out.sounds.push(...(CATALOG.abilities.get(e.boss.abilityId)?.vfx.slice(0, 1) ?? []));
        const fam = CATALOG.abilities.get(e.boss.abilityId)?.vfx ?? [];
        if (fam.includes('howl')) out.impact.push({ kind: 'howl', at: 'boss' });
        if (fam.includes('quake')) e.boss.targets.forEach((t) => out.impact.push({ kind: 'shake', at: t }));
        break;
      }
      case 'shield':
        if (e.applied) out.shields.push({ kind: CATALOG.abilities.get(e.source)?.vfx.includes('mirror') ? 'mirror' : 'shield', at: e.unit, text: `🛡${e.value}`, tone: 'info' });
        else out.shields.push({ kind: 'text', at: e.unit, text: 'صدّ أضعف: لا تغيير', tone: 'info' });
        break;
      case 'barrierRemoved':
        out.shields.push({ kind: 'barrier-break', at: e.unit, text: `🛡✕`, tone: 'info', delay: 150 });
        break;
      case 'cleanse':
        if (e.removed.length) out.shields.push({ kind: 'cleanse', at: e.unit, delay: 100 });
        break;
      case 'heal':
        out.impact.push({ kind: 'heal', at: e.unit, delay: 60 });
        out.impact.push({ kind: 'number', at: e.unit, text: `+${e.amount}`, tone: 'heal', delay: 220 });
        break;
      case 'hit': {
        const fam = attackFamily(e.source);
        out.impact.push({ kind: fam === 'quake' ? 'claw' : fam === 'howl' ? 'claw' : fam, at: e.to, from: TRAVEL.includes(fam) ? e.from : undefined });
        out.impact.push({ kind: 'number', at: e.to, text: `-${e.dealt}`, tone: 'dmg', delay: 260 });
        if (e.absorbed > 0) out.impact.push({ kind: 'text', at: e.to, text: `🛡امتص ${e.absorbed}`, tone: 'absorb', delay: 420 });
        if (e.piercing) out.impact.push({ kind: 'text', at: e.to, text: 'ثاقب', tone: 'info', delay: 100 });
        if (e.dealt > 0) out.impact.push({ kind: 'shake', at: e.to });
        break;
      }
      case 'reflect':
        out.impact.push({ kind: 'mirror', at: e.to, from: e.from, delay: 300 });
        out.impact.push({ kind: 'number', at: e.to, text: `-${e.amount}↩`, tone: 'dmg', delay: 480 });
        break;
      case 'status': {
        if (!e.applied) break;
        const s = STATUS_FX[e.status];
        if (!s) break;
        out.statuses.push({ kind: s.kind, at: e.unit, text: `${s.icon}${e.status === 'mark' || e.status === 'focus' ? `+${e.value}` : e.status === 'weaken' ? e.value : ''}`, tone: s.tone });
        break;
      }
      case 'consumed':
        if (e.status === 'expose') out.impact.push({ kind: 'text', at: e.unit, text: '✦−1', tone: 'buff', delay: 520 });
        break;
      case 'fell':
        out.statuses.push({ kind: 'fall', at: e.unit, text: 'سقط', tone: 'info' });
        break;
      case 'effectFailed':
        out.shields.push({ kind: 'text', at: e.unit, text: e.reason === 'dead' ? 'الهدف ساقط' : 'هدف ممنوع', tone: 'info' });
        break;
      case 'dotTick':
        out.impact.push({ kind: 'dot-pulse', at: e.unit, tone: e.status, text: `${e.status === 'burn' ? '🔥' : e.status === 'poison' ? '☠' : '🩸'}-${e.amount}` });
        if (!out.sounds.includes(e.status === 'burn' ? 'fire' : 'poison')) out.sounds.push(e.status === 'burn' ? 'fire' : 'poison');
        break;
      default:
        break;
    }
  }
  return out;
}
