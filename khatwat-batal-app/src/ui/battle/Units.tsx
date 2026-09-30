import type { ReactNode } from 'react';
import { CATALOG, displayUrl, heroImageForLevel, ROLE_LABEL } from '../../catalog';
import { cosmeticLevel } from '../../engine/economy';
import type { BossUnit, HeroUnit } from '../../engine/battle/types';
import { Num } from '../components/common';
import { Icon } from '../components/Icon';
import { tintClass } from './roles';

type Chip = { key: string; cls: string; label: string; title: string };

export function heroChips(h: HeroUnit): Chip[] {
  const c: Chip[] = [];
  if (h.shield) c.push({ key: 'shield', cls: 'st-shield', label: `🛡${h.shield.value}`, title: `صدّ ${h.shield.value} (ينتهي بنهاية الجولة ${h.shield.expiresRound})` });
  if (h.poison) c.push({ key: 'poison', cls: 'st-poison', label: `☠${h.poison.amount}×${h.poison.ticks}`, title: `سم ${h.poison.amount} × ${h.poison.ticks} نهاية جولة` });
  if (h.bleed) c.push({ key: 'bleed', cls: 'st-bleed', label: `🩸${h.bleed.amount}×${h.bleed.ticks}`, title: `نزيف ${h.bleed.amount} × ${h.bleed.ticks} نهاية جولة` });
  if (h.focus) c.push({ key: 'focus', cls: 'st-focus', label: `🎯+${h.focus.value}`, title: `تركيز +${h.focus.value} لضربته المباشرة التالية` });
  if (h.weaken) c.push({ key: 'weaken', cls: 'st-weaken', label: `⬇${h.weaken.value}`, title: `إضعاف ضربته المباشرة التالية بـ${h.weaken.value}` });
  return c;
}

export function bossChips(b: BossUnit): Chip[] {
  const c: Chip[] = [];
  if (b.shield)
    c.push({
      key: 'shield',
      cls: b.shield.reflect ? 'st-mirror' : 'st-shield',
      label: `🛡${b.shield.value}${b.shield.reflect ? ` ↩${b.shield.reflect}` : ''}`,
      title: `صدّ ${b.shield.value}${b.shield.reflect ? ` مع انعكاس ${b.shield.reflect}` : ''} (ينتهي بنهاية الجولة ${b.shield.expiresRound})`,
    });
  if (b.burn) c.push({ key: 'burn', cls: 'st-burn', label: `🔥${b.burn.amount}×${b.burn.ticks}`, title: `احتراق ${b.burn.amount} × ${b.burn.ticks} نهاية جولة` });
  if (b.mark) c.push({ key: 'mark', cls: 'st-mark', label: `◎+${b.mark.value}`, title: `علامة صيد +${b.mark.value} للضربة المباشرة التالية` });
  if (b.expose) c.push({ key: 'expose', cls: 'st-expose', label: `✦+${b.expose.bonus}×${b.expose.charges}`, title: `كشف الثغرة +${b.expose.bonus} لـ${b.expose.charges} ضربة` });
  if (b.weaken) c.push({ key: 'weaken', cls: 'st-weaken', label: `⬇${b.weaken.value}`, title: `إضعاف هجومه المباشر التالي بـ${b.weaken.value} لكل هدف` });
  return c;
}

export function StatusChips({ chips }: { chips: Chip[] }) {
  if (!chips.length) return null;
  return (
    <span className="status-chips">
      {chips.map((c) => (
        <span key={c.key} className={`st ${c.cls}`} title={c.title} aria-label={c.title}>
          <bdi>{c.label}</bdi>
        </span>
      ))}
    </span>
  );
}

export function HpBar({ hp, max, kind }: { hp: number; max: number; kind: 'hero' | 'boss' }) {
  const pct = Math.max(0, Math.min(100, (hp / max) * 100));
  const tone = pct > 50 ? 'hp-high' : pct > 25 ? 'hp-mid' : 'hp-low';
  return (
    <span className={`hp hp-${kind} ${tone}`} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={hp} aria-label={`الحياة ${hp} من ${max}`}>
      <span className="hp-track">
        <span className="hp-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="hp-text">
        <Num>
          {hp}/{max}
        </Num>
      </span>
    </span>
  );
}

/** بانر الزعيم: صورته الأصلية من الحافة إلى الحافة، والاسم والجولة والمرحلة والحياة فوقها. */
export function BossBanner({
  boss,
  phase,
  phase2Pending,
  round,
  onDetails,
  selfTarget,
  children,
}: {
  boss: BossUnit;
  phase: 1 | 2;
  phase2Pending: boolean;
  round: number;
  onDetails?: () => void;
  /** حركة الزعيم المحددة تستهدفه هو. */
  selfTarget?: boolean;
  /** أزرار فوق الصورة (زر الإعدادات في الزاوية اليسرى). */
  children?: ReactNode;
}) {
  const def = CATALOG.bossById.get(boss.bossId)!;
  return (
    <section className={`boss-banner ${selfTarget ? 'self-target' : ''}`} data-unit="boss" aria-label={`الزعيم ${def.name}`}>
      <img className="bb-img" src={displayUrl(def.image)} alt={def.name} style={{ objectPosition: def.bannerPosition }} draggable={false} />
      <span className="bb-shade" aria-hidden="true" />
      <span className="bb-frame" aria-hidden="true" />
      <div className="bb-top">
        <button type="button" className="bb-name" onClick={onDetails} aria-label={`تفاصيل ${def.name}: الحياة والحالات`}>
          <strong>{def.name}</strong>
          <small>{def.title}</small>
        </button>
        <span className="bb-pills">
          <span className="round-badge">
            الجولة <Num>{round}</Num>
          </span>
          <span className={`phase-badge ${phase === 2 ? 'p2' : ''}`}>
            المرحلة <Num>{phase}</Num>
            {phase2Pending ? ' ← 2' : ''}
          </span>
        </span>
      </div>
      <div className="bb-bottom">
        <StatusChips chips={bossChips(boss)} />
        <HpBar hp={boss.hp} max={boss.maxHp} kind="boss" />
      </div>
      {children}
    </section>
  );
}

export type HeroMark = 'selectable' | 'dimmed' | 'threat' | 'current' | null;

export function HeroToken({ unit, wins, mark, onTap }: { unit: HeroUnit; wins: number; mark: HeroMark; onTap: () => void }) {
  const def = CATALOG.heroById.get(unit.heroId)!;
  const fallen = unit.hp <= 0;
  const lvl = cosmeticLevel(wins);
  const chips = heroChips(unit);
  return (
    <button
      type="button"
      className={`hero-token ${tintClass(def.role)} lvl-${lvl} ${fallen ? 'fallen' : ''} ${mark ?? ''}`}
      data-unit={`h${unit.slot}`}
      style={{ gridArea: `h${unit.slot}` }}
      disabled={mark === 'dimmed'}
      onClick={onTap}
      aria-label={`${def.name}، ${ROLE_LABEL[def.role]}، الحياة ${unit.hp} من ${unit.maxHp}${fallen ? '، ساقط' : ''}${mark === 'threat' ? '، مستهدف من حركة الزعيم المحددة' : ''}${mark === 'selectable' ? '، اضغط لاختياره هدفًا' : ''}`}
    >
      <span className="ht-frame">
        <span className="ht-img">
          <img src={displayUrl(heroImageForLevel(def, lvl))} alt="" draggable={false} />
        </span>
        <span className="ht-role" title={ROLE_LABEL[def.role]} aria-hidden="true">
          <Icon name={`role-${def.role}`} size={11} />
        </span>
        {chips.length ? <StatusChips chips={chips} /> : null}
        {fallen ? <span className="fallen-tag">ساقط</span> : null}
        {mark === 'threat' ? <span className="ht-mark threat-mark" aria-hidden="true" /> : null}
        {mark === 'current' ? <span className="ht-mark current-mark" aria-hidden="true" /> : null}
      </span>
      <span className="ht-name">{heroShortName(def.id)}</span>
      <HpBar hp={unit.hp} max={unit.maxHp} kind="hero" />
    </button>
  );
}

export function heroShortName(heroId: string): string {
  const n = CATALOG.heroById.get(heroId)?.name ?? heroId;
  return n.split(' ')[0];
}

function expiry(r: number) {
  return `حتى نهاية الجولة ${r}`;
}

/** تفاصيل وحدة: الحياة والصدّ ومدد الحالات وعدد الشحنات. */
export function unitDetailLines(u: HeroUnit | BossUnit): string[] {
  const out: string[] = [`الحياة ${u.hp} من ${u.maxHp}`];
  const any = u as HeroUnit & BossUnit;
  if (any.shield) out.push(`صدّ ${any.shield.value}${any.shield.reflect ? ` مع انعكاس ${any.shield.reflect}` : ''} — ${expiry(any.shield.expiresRound)} إن لم يُستهلك`);
  if (any.burn) out.push(`احتراق ${any.burn.amount} × ${any.burn.ticks} نهاية جولة متبقية`);
  if (any.poison) out.push(`سم ${any.poison.amount} × ${any.poison.ticks} نهاية جولة متبقية`);
  if (any.bleed) out.push(`نزيف ${any.bleed.amount} × ${any.bleed.ticks} نهاية جولة متبقية`);
  if (any.focus) out.push(`تركيز +${any.focus.value} لضربته المباشرة التالية — ${expiry(any.focus.expiresRound)}`);
  if (any.mark) out.push(`علامة صيد +${any.mark.value} للضربة المباشرة التالية من الفريق — ${expiry(any.mark.expiresRound)}`);
  if (any.expose) out.push(`كشف الثغرة +${any.expose.bonus} لكل ضربة، الشحنات المتبقية ${any.expose.charges} — ${expiry(any.expose.expiresRound)}`);
  if (any.weaken) out.push(`إضعاف الهجوم المباشر التالي بـ${any.weaken.value}${'role' in u ? '' : ' لكل هدف'} — ${expiry(any.weaken.expiresRound)}`);
  if (out.length === 1) out.push('لا حالات نشطة');
  return out;
}
