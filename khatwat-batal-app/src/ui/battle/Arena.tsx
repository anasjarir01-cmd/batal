// ساحة القتال بالترتيب الإلزامي من أعلى لأسفل: بانر الزعيم، حركاته الثلاث، خطة اللاعب
// (زر التنفيذ يسارًا ومؤشر الطاقة يمينًا)، اليد، الأبطال. لا شريط تنقل ولا ترويسة أثناء المعركة.
// لمسة واحدة تختار، ولمستان سريعتان تكبّران؛ القواعد والأرقام كلها من المحرك دون تغيير.
import { useEffect, useMemo, useRef, useState } from 'react';
import { sfx, sfxForFamily } from '../../audio/sfx';
import { CATALOG, displayUrl, heroImageForLevel } from '../../catalog';
import { cosmeticLevel } from '../../engine/economy';
import { legalTargets, needsTarget, validatePlan, ENERGY_PER_ROUND, PLAN_SLOTS } from '../../engine/battle/engine';
import type { BattleState, BoardSnapshot, BossAction, PlannedCard } from '../../engine/battle/types';
import { usePwa } from '../../pwa/register';
import { act, getDb } from '../../store/appStore';
import { commitRound, OpError, retreatBattle, setMeta, setPlaybackCursor, type AppData } from '../../store/ops';
import { Num, Sheet } from '../components/common';
import { confirmDialog, toast } from '../components/dialogs';
import { Icon } from '../components/Icon';
import { goto, openOverlay } from '../nav';
import { ArenaMenu } from './ArenaMenu';
import { HandPager } from './HandPager';
import { fxForGroup, groupEvents } from './playback';
import { abilityTint, tintClass, type Tint } from './roles';
import { BossBanner, HeroToken, heroShortName, unitDetailLines, type HeroMark } from './Units';
import { useTap } from './useTap';
import { VfxLayer, type VfxHandle } from './Vfx';

interface View {
  board: BoardSnapshot;
  revealed: number[];
  activeSlot: number | null;
  doneSlots: number[];
  zoom: { player?: string; boss: string } | null;
  banner: string | null;
}

/** وضع التفاعل الحالي في الساحة. */
type Mode =
  | { kind: 'idle' }
  /** بطاقة جديدة من اليد تنتظر اختيار هدفها. */
  | { kind: 'target'; cardId: string }
  /** بطاقة مخططة محددة: تُنقل بلمس خانة أخرى، أو يُغيَّر هدفها بلمس بطل. */
  | { kind: 'slot'; index: number }
  /** حركة زعيم ظاهرة محددة: أهدافها مُعلَّمة على الأبطال. */
  | { kind: 'boss'; k: number };

const IDLE: Mode = { kind: 'idle' };
const progressMemo = new Map<string, number>();
type Draft = { key: string; plan: PlannedCard[] };
let draftMemo: Draft | null = null;

function boardOf(s: BattleState): BoardSnapshot {
  return { round: s.round, phase: s.phase, phase2Pending: s.phase2Pending, heroes: s.heroes, boss: s.boss };
}

function isHidden() {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function waitVisible(): Promise<void> {
  if (!isHidden()) return Promise.resolve();
  return new Promise((res) => {
    const h = () => {
      if (!isHidden()) {
        document.removeEventListener('visibilitychange', h);
        res();
      }
    };
    document.addEventListener('visibilitychange', h);
  });
}

export function Arena({ data, reducedMotion }: { data: AppData; reducedMotion: boolean }) {
  const rec = data.battle;
  const live = rec.state as BattleState;
  const exec = rec.execution;
  const speed = data.settings.battleSpeed;
  const wins = useMemo(() => Object.fromEntries(data.heroes.map((h) => [h.heroId, h.wins])), [data.heroes]);
  const rootRef = useRef<HTMLDivElement>(null);
  const vfx = useRef<VfxHandle>(null);
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>(IDLE);
  const [menuOpen, setMenuOpen] = useState(false);
  const [detail, setDetail] = useState<'boss' | number | null>(null);
  const [hiddenZoom, setHiddenZoom] = useState<number | null>(null);
  const updateReady = usePwa().updateReady;

  // ——— الخطة (مسودة محفوظة لا تؤثر في الحساب) ———
  const draftKey = `${live.battleId}:${live.round}`;
  const [plan, setPlan] = useState<PlannedCard[]>(() => {
    // آخر مسودة محفوظة: من الذاكرة إن خرج اللاعب من الساحة وعاد، وإلا من التخزين بعد إعادة التحميل
    const d = draftMemo?.key === draftKey ? draftMemo : (data.meta.battleDraft as Draft | undefined);
    if (d?.key === draftKey && validatePlan(live, d.plan) === null) return d.plan;
    return [];
  });
  // مراجع لأحدث قيمة: اللمسة الواحدة تُنفَّذ بعد مهلة قصيرة، فلا يجوز أن تقرأ خطة قديمة.
  const planRef = useRef(plan);
  const modeRef = useRef(mode);
  const liveRef = useRef(live);
  const lockedRef = useRef(false);
  planRef.current = plan;
  modeRef.current = mode;
  liveRef.current = live;
  const commitPlan = (next: PlannedCard[]) => {
    planRef.current = next;
    setPlan(next);
  };
  const setModeNow = (m: Mode) => {
    modeRef.current = m;
    setMode(m);
  };

  const planKeyRef = useRef(draftKey);
  useEffect(() => {
    if (planKeyRef.current !== draftKey) {
      planKeyRef.current = draftKey;
      commitPlan([]);
      setModeNow(IDLE);
    }
  }, [draftKey]);
  useEffect(() => {
    draftMemo = { key: draftKey, plan };
    void setMeta(getDb(), 'battleDraft', draftMemo).catch(() => undefined);
  }, [plan, draftKey]);

  const playing = !!exec && Math.max(exec.cursor, progressMemo.get(exec.id) ?? 0) < exec.events.length;

  // ——— عرض التنفيذ من سجل الأحداث ———
  useEffect(() => {
    if (!exec) return;
    const startCursor = Math.max(exec.cursor, progressMemo.get(exec.id) ?? 0);
    if (startCursor >= exec.events.length) {
      setView(null);
      return;
    }
    let cancelled = false;
    const groups = groupEvents(exec.events);
    let gi = groups.findIndex((g) => g.end >= startCursor);
    if (gi < 0) gi = groups.length;
    let board = boardOf(exec.before);
    const doneSlots: number[] = [];
    const revealed: number[] = [];
    for (let i = 0; i < gi; i++) {
      const g = groups[i];
      if (g.snapshot) board = g.snapshot;
      if (g.kind === 'slot' && g.slot !== undefined) {
        doneSlots.push(g.slot);
        revealed.push(g.slot);
      }
    }
    let v: View = { board, revealed, activeSlot: null, doneSlots, zoom: null, banner: null };
    setView(v);
    setModeNow(IDLE);
    const upd = (p: Partial<View>) => {
      v = { ...v, ...p };
      if (!cancelled) setView(v);
    };
    const sleep = async (ms: number) => {
      let left = ms / speed;
      while (left > 0 && !cancelled) {
        if (isHidden()) {
          await waitVisible();
          continue;
        }
        const step = Math.min(left, 40);
        await new Promise((r) => setTimeout(r, step));
        left -= step;
      }
    };
    const saveCursor = (c: number) => {
      progressMemo.set(exec.id, c);
      void setPlaybackCursor(getDb(), exec.id, c).catch(() => undefined);
    };
    (async () => {
      for (; gi < groups.length; gi++) {
        if (cancelled) return;
        await waitVisible();
        const g = groups[gi];
        const fx = fxForGroup(g);
        if (g.kind === 'slot' && g.slot !== undefined) {
          const k = g.slot;
          const start = g.events[0];
          upd({ activeSlot: k });
          if (start.t === 'slotStart' && start.boss.wasHidden && !v.revealed.includes(k)) {
            sfx.flip();
            upd({ revealed: [...v.revealed, k] });
            await sleep(reducedMotion ? 200 : 380);
          }
          if (start.t === 'slotStart') {
            upd({ zoom: { player: start.player && !start.player.cancelled ? start.player.abilityId : undefined, boss: start.boss.abilityId } });
            await sleep(reducedMotion ? 450 : 620);
            upd({ zoom: null });
          }
          if (fx.shields.length) {
            vfx.current?.spawn(fx.shields, speed, reducedMotion);
            await sleep(240);
          }
          vfx.current?.spawn(fx.impact, speed, reducedMotion);
          fx.sounds.forEach((s, i) => setTimeout(() => sfxForFamily(s), (i * 120) / speed));
          if (g.snapshot) upd({ board: g.snapshot });
          await sleep(460);
          if (fx.statuses.length) vfx.current?.spawn(fx.statuses, speed, reducedMotion);
          if (g.events.some((e) => e.t === 'fell')) sfx.fall();
          await sleep(420);
          upd({ activeSlot: null, doneSlots: [...v.doneSlots, k] });
        } else if (g.kind === 'end') {
          if (fx.impact.length) {
            vfx.current?.spawn(fx.impact, speed, reducedMotion);
            fx.sounds.forEach((s) => sfxForFamily(s));
          }
          if (g.snapshot) upd({ board: g.snapshot });
          await sleep(fx.impact.length ? 750 : 200);
        } else {
          if (g.events.some((e) => e.t === 'phase2')) {
            upd({ banner: 'المرحلة الثانية! تغيّرت قاعدة اختيار الأهداف' });
            sfx.debuff();
            await sleep(1300);
            upd({ banner: null });
          }
        }
        const outcome = g.events.find((e) => e.t === 'outcome');
        if (outcome && outcome.t === 'outcome') {
          if (outcome.outcome === 'victory') sfx.victory();
          else sfx.defeat();
          await sleep(600);
        }
        saveCursor(g.end + 1);
      }
      if (cancelled) return;
      progressMemo.set(exec.id, exec.events.length);
      await act((db) => setPlaybackCursor(db, exec.id, exec.events.length));
      setView(null);
    })();
    return () => {
      cancelled = true;
      vfx.current?.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exec?.id]);

  const skipPlayback = async () => {
    if (!exec) return;
    progressMemo.set(exec.id, exec.events.length);
    vfx.current?.clear();
    await act((db) => setPlaybackCursor(db, exec.id, exec.events.length));
    setView(null);
  };

  // ——— مصادر العرض ———
  const shownState: BattleState = playing && exec ? exec.before : live;
  const board: BoardSnapshot = view?.board ?? boardOf(live);
  const shownPlan: PlannedCard[] = playing && exec ? exec.plan : plan;
  const bossPlan: BossAction[] = shownState.bossPlan;
  const planIds = new Set(shownPlan.map((p) => p.cardId));
  const hand = playing && exec ? exec.before.hand.filter((id) => !planIds.has(id)) : live.hand;
  const cost = (st: BattleState, id: string) => CATALOG.abilities.get(st.cards[id].abilityId)?.cost ?? 0;
  const usedOf = (st: BattleState, p: PlannedCard[]) => p.reduce((s, q) => s + cost(st, q.cardId), 0);
  const remaining = ENERGY_PER_ROUND - usedOf(shownState, shownPlan);
  const locked = playing || busy;
  lockedRef.current = locked;
  const planError = locked ? null : validatePlan(live, plan);
  const canExecute = !locked && plan.length > 0 && planError === null;
  const visibleMove = (k: number) => !bossPlan[k].hidden || (view?.revealed.includes(k) ?? false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modeRef.current.kind !== 'idle') setModeNow(IDLE);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ——— تفاعل التخطيط (يقرأ دائمًا أحدث حالة عبر المراجع) ———
  function selectCard(id: string) {
    if (lockedRef.current) return;
    const st = liveRef.current;
    const cur = planRef.current;
    const m = modeRef.current;
    const existing = cur.findIndex((p) => p.cardId === id);
    if (existing >= 0) {
      commitPlan(cur.filter((_, i) => i !== existing));
      setModeNow(IDLE);
      sfx.deselect();
      return;
    }
    if (m.kind === 'target' && m.cardId === id) {
      setModeNow(IDLE);
      sfx.deselect();
      return;
    }
    const a = CATALOG.abilities.get(st.cards[id].abilityId)!;
    const left = ENERGY_PER_ROUND - usedOf(st, cur);
    if (cur.length >= PLAN_SLOTS) return toast('ثلاث بطاقات كحد أقصى في الجولة', 'info');
    if ((a.cost ?? 0) > left) return toast(`الطاقة لا تكفي: ${a.name} تحتاج ${a.cost} والمتاح ${left}`, 'info');
    if (needsTarget(st, id)) {
      if (!legalTargets(st, id).length) return toast(a.heroTarget === 'ally-other' ? 'لا يوجد حليف آخر حي لهذه القدرة' : 'لا يوجد هدف حي', 'info');
      setModeNow({ kind: 'target', cardId: id });
      sfx.select();
      return;
    }
    commitPlan([...cur, { cardId: id }]);
    setModeNow(IDLE);
    sfx.select();
  }

  function tapHero(slot: number) {
    const st = liveRef.current;
    const cur = planRef.current;
    const m = modeRef.current;
    if (!lockedRef.current && m.kind === 'target') {
      if (legalTargets(st, m.cardId).includes(slot)) {
        commitPlan([...cur, { cardId: m.cardId, target: slot }]);
        setModeNow(IDLE);
        sfx.select();
      }
      return;
    }
    if (!lockedRef.current && m.kind === 'slot') {
      const p = cur[m.index];
      if (p && needsTarget(st, p.cardId) && legalTargets(st, p.cardId).includes(slot)) {
        commitPlan(cur.map((q, i) => (i === m.index ? { ...q, target: slot } : q)));
        setModeNow(IDLE);
        sfx.select();
        return;
      }
    }
    setDetail(slot);
  }

  function tapSlot(k: number) {
    if (lockedRef.current) return;
    const cur = planRef.current;
    const m = modeRef.current;
    if (m.kind === 'slot' && m.index < cur.length) {
      const i = m.index;
      if (k === i) {
        setModeNow(IDLE);
        sfx.deselect();
        return;
      }
      if (k >= cur.length) {
        // الخطة متصلة (الخانة k تقابل حركة الزعيم k)، فالخانة الفارغة ليست وجهة نقل.
        setModeNow(IDLE);
        return;
      }
      const next = cur.slice();
      [next[i], next[k]] = [next[k], next[i]];
      commitPlan(next);
      setModeNow(IDLE);
      sfx.select();
      return;
    }
    if (k < cur.length) {
      setModeNow({ kind: 'slot', index: k });
      sfx.select();
    }
  }

  function removeSlot(k: number) {
    if (lockedRef.current) return;
    const cur = planRef.current;
    if (k >= cur.length) return;
    commitPlan(cur.filter((_, i) => i !== k));
    setModeNow(IDLE);
    sfx.deselect();
  }

  function tapBoss(k: number) {
    if (!visibleMove(k)) {
      toast(`حركة الزعيم ${k + 1} تُكشف لحظة تنفيذ خانتها`, 'info');
      return;
    }
    const m = modeRef.current;
    setModeNow(m.kind === 'boss' && m.k === k ? IDLE : { kind: 'boss', k });
  }

  function zoomBoss(k: number) {
    if (!visibleMove(k)) return setHiddenZoom(k);
    openOverlay({ kind: 'card', abilityId: bossPlan[k].abilityId });
  }

  async function execute() {
    if (lockedRef.current) return;
    const cur = planRef.current;
    if (!cur.length) return;
    const err = validatePlan(liveRef.current, cur);
    if (err) return toast(err, 'error');
    lockedRef.current = true;
    setBusy(true);
    setModeNow(IDLE);
    try {
      await act((db) => commitRound(db, rec.rev, cur));
      sfx.confirm();
    } catch (e) {
      toast(e instanceof OpError ? e.message : 'تعذر تنفيذ الجولة', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function passRound() {
    setMenuOpen(false);
    if (lockedRef.current) return;
    const ok = await confirmDialog({
      title: 'تمرير الجولة؟',
      body: <p>لن تُلعب أي بطاقة هذه الجولة{planRef.current.length ? ' (ولا البطاقات الموضوعة في الخطة)' : ''}، وسينفذ الزعيم حركاته الثلاث.</p>,
      confirmText: 'تمرير',
    });
    if (!ok || lockedRef.current) return;
    lockedRef.current = true;
    setBusy(true);
    setModeNow(IDLE);
    try {
      await act((db) => commitRound(db, rec.rev, []));
      sfx.confirm();
    } catch (e) {
      toast(e instanceof OpError ? e.message : 'تعذر تمرير الجولة', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function doRetreat() {
    setMenuOpen(false);
    if (lockedRef.current) return;
    const ok = await confirmDialog({
      title: 'الانسحاب من المعركة؟',
      body: <p>تنتهي المعركة فورًا دون انتصارات للأبطال، ولا توجد أي عقوبة. لا يمكن التراجع بعد التأكيد.</p>,
      confirmText: 'انسحاب',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await act((db) => retreatBattle(db, rec.rev));
    } catch (e) {
      toast(e instanceof OpError ? e.message : 'تعذر الانسحاب', 'error');
    }
  }

  // ——— علامات العرض ———
  const cycleStart = Math.floor((shownState.round - 1) / 3) * 3 + 1;
  const executedThisCycle = shownState.bossHistory.filter((h) => h.round >= cycleStart && h.round < shownState.round);
  const pendingCard = mode.kind === 'target' ? mode.cardId : null;
  const selSlot = mode.kind === 'slot' && mode.index < shownPlan.length ? mode.index : null;
  const selPlanned = selSlot !== null ? shownPlan[selSlot] : undefined;
  const selNeedsTarget = !!selPlanned && needsTarget(live, selPlanned.cardId);
  const inspected = mode.kind === 'boss' && visibleMove(mode.k) ? bossPlan[mode.k] : undefined;

  function heroMark(slot: number): HeroMark {
    if (pendingCard) return legalTargets(live, pendingCard).includes(slot) ? 'selectable' : 'dimmed';
    if (selPlanned && selNeedsTarget) {
      if (selPlanned.target === slot) return 'current';
      return legalTargets(live, selPlanned.cardId).includes(slot) ? 'selectable' : null;
    }
    if (inspected?.targets.includes(slot)) return 'threat';
    return null;
  }

  let hint: string | null = null;
  if (pendingCard) hint = `اختر هدفًا لـ«${CATALOG.abilities.get(live.cards[pendingCard].abilityId)?.name}» من الأبطال`;
  else if (selPlanned) {
    const canMove = shownPlan.length > 1;
    hint = selNeedsTarget ? (canMove ? 'المس خانة أخرى لتبديل الترتيب، أو بطلًا لتغيير الهدف' : 'المس بطلًا لتغيير هدف البطاقة') : canMove ? 'المس خانة أخرى لتبديل ترتيب البطاقتين' : 'ضع بطاقة أخرى لتتمكن من تبديل الترتيب';
  }
  else if (inspected && mode.kind === 'boss') hint = inspected.targets.length ? `أهداف حركة الزعيم ${mode.k + 1} مُعلَّمة على الأبطال` : `حركة الزعيم ${mode.k + 1} تخصّه هو`;

  return (
    <div className={`arena ${playing ? 'is-playing' : ''} ${mode.kind !== 'idle' ? `mode-${mode.kind}` : ''}`} ref={rootRef} data-testid="arena">
      <div className="arena-sky" aria-hidden="true">
        <span className="aurora au1" />
        <span className="aurora au2" />
        <span className="aurora au3" />
        <svg className="sky-lines" viewBox="0 0 400 800" preserveAspectRatio="none">
          <path d="M-20 170 C 90 120, 200 210, 420 140" />
          <path d="M-20 420 C 120 370, 260 470, 420 390" />
          <path d="M-20 640 C 140 600, 250 690, 420 620" />
          <path className="thin" d="M-20 300 C 110 270, 240 330, 420 280" />
        </svg>
        <span className="stars s1" />
        <span className="stars s2" />
      </div>
      <VfxLayer ref={vfx} rootRef={rootRef} />

      {/* 1 — بانر الزعيم، وزر القائمة أعلى يساره */}
      <BossBanner boss={board.boss} phase={board.phase} phase2Pending={board.phase2Pending} round={board.round} onDetails={() => setDetail('boss')} selfTarget={!!inspected && !inspected.targets.length}>
        <div className="bb-tools">
          <button className="bb-gear" onClick={() => setMenuOpen(true)} aria-label={updateReady && !playing ? 'قائمة المعركة (تحديث جديد جاهز)' : 'قائمة المعركة'} aria-haspopup="dialog" data-testid="arena-menu-btn">
            <Icon name="gear" size={22} />
            {updateReady && !playing ? <i className="bb-dot" aria-hidden="true" /> : null}
          </button>
          {playing ? (
            <button className="bb-skip" onClick={() => void skipPlayback()} aria-label="تخطي العرض">
              <Icon name="skip" size={14} /> تخطي
            </button>
          ) : null}
        </div>
      </BossBanner>

      <div className="arena-body">
        {/* 2 — حركات الزعيم الثلاث: 1 يمينًا، 2 وسطًا، 3 يسارًا */}
        <section className="boss-moves" data-testid="boss-moves" aria-label="حركات الزعيم">
          {bossPlan.map((b, k) => (
            <BossMoveCard
              key={k}
              k={k}
              abilityId={visibleMove(k) ? b.abilityId : null}
              flipIn={b.hidden}
              active={view?.activeSlot === k}
              done={!!view?.doneSlots.includes(k)}
              inspected={mode.kind === 'boss' && mode.k === k}
              onTap={() => tapBoss(k)}
              onZoom={() => zoomBoss(k)}
            />
          ))}
        </section>

        {/* 3 — الخطة: من اليسار فعليًا: تنفيذ | خانة3 | خانة2 | خانة1 | الطاقة */}
        <section className="plan-row" data-testid="plan-row" aria-label="خطة اللاعب">
          <div className="energy-bar" data-testid="energy" role="meter" aria-valuemin={0} aria-valuemax={ENERGY_PER_ROUND} aria-valuenow={remaining} aria-label={`الطاقة المتاحة ${remaining} من ${ENERGY_PER_ROUND}`}>
            <Icon name="bolt" size={18} />
            <span className="en-num">
              <Num>
                {remaining}/{ENERGY_PER_ROUND}
              </Num>
            </span>
            <span className="en-pips" aria-hidden="true">
              {Array.from({ length: ENERGY_PER_ROUND }, (_, i) => (
                <i key={i} className={i < remaining ? 'on' : ''} />
              ))}
            </span>
          </div>
          {Array.from({ length: PLAN_SLOTS }, (_, k) => {
            const p = shownPlan[k];
            const ghost = !p && pendingCard && k === shownPlan.length ? pendingCard : null;
            const cardId = p?.cardId ?? ghost;
            const a = cardId ? CATALOG.abilities.get(shownState.cards[cardId].abilityId) : undefined;
            const targetHero = p?.target !== undefined ? shownState.heroes[p.target] : undefined;
            return (
              <PlanSlot
                key={k}
                k={k}
                abilityId={a?.id ?? null}
                name={a?.name ?? ''}
                ghost={!!ghost}
                targetImg={targetHero ? displayUrl(heroImageForLevel(CATALOG.heroById.get(targetHero.heroId)!, cosmeticLevel(wins[targetHero.heroId] ?? 0))) : null}
                targetName={targetHero ? heroShortName(targetHero.heroId) : null}
                selected={selSlot === k}
                moveTarget={selSlot !== null && selSlot !== k && k < shownPlan.length}
                active={view?.activeSlot === k}
                done={!!view?.doneSlots.includes(k)}
                locked={locked}
                onTap={() => tapSlot(k)}
                onZoom={() => (p && a ? openOverlay({ kind: 'card', abilityId: a.id, cardId: p.cardId, target: p.target }) : a ? openOverlay({ kind: 'card', abilityId: a.id }) : undefined)}
                onRemove={() => (ghost ? setModeNow(IDLE) : removeSlot(k))}
              />
            );
          })}
          <button className={`exec-btn ${busy ? 'busy' : ''}`} onClick={() => void execute()} disabled={!canExecute} data-testid="execute" aria-label={plan.length ? 'تنفيذ الجولة' : 'تنفيذ: ضع بطاقة واحدة على الأقل في الخطة'} title={planError ?? undefined}>
            <Icon name="swords" size={20} />
            <span className="exec-label">تنفيذ</span>
          </button>
        </section>

        {/* 4 — يد القدرات: أربع بطاقات ظاهرة، والسحب يكشف الباقي */}
        <HandPager
          items={hand}
          resetKey={`${live.round}:${playing ? 'play' : 'plan'}`}
          render={(id) => {
            const a = CATALOG.abilities.get(shownState.cards[id].abilityId)!;
            const idx = shownPlan.findIndex((p) => p.cardId === id);
            const planned = idx >= 0;
            const tooCostly = !planned && (a.cost ?? 0) > remaining;
            return (
              <HandCard
                abilityId={a.id}
                name={a.name}
                cost={a.cost ?? 0}
                tint={abilityTint(a.id)}
                planned={planned ? idx + 1 : null}
                pending={pendingCard === id}
                dim={tooCostly || locked}
                onSelect={() => selectCard(id)}
                onZoom={() => openOverlay({ kind: 'card', abilityId: a.id, cardId: id, target: planned ? shownPlan[idx].target : undefined })}
              />
            );
          }}
        />

        {/* 5 — الأبطال الخمسة في خانات أدوارهم */}
        <section className="heroes-row" data-testid="heroes-row" aria-label="الأبطال">
          {hint ? (
            <p className="mode-hint" role="status">
              {hint}
            </p>
          ) : null}
          {board.heroes.map((h) => (
            <HeroToken key={h.slot} unit={h} wins={wins[h.heroId] ?? 0} mark={heroMark(h.slot)} onTap={() => tapHero(h.slot)} />
          ))}
        </section>
      </div>

      {view?.zoom ? (
        <div className="pair-zoom" aria-hidden="true">
          {view.zoom.player ? (
            <span className={`pz-card ${tintClass(abilityTint(view.zoom.player))}`}>
              <img src={displayUrl(CATALOG.abilities.get(view.zoom.player)!.image)} alt="" />
            </span>
          ) : (
            <span className="pz-card pair-empty">—</span>
          )}
          <span className="vs">VS</span>
          <span className="pz-card role-boss">
            <img src={displayUrl(CATALOG.abilities.get(view.zoom.boss)!.image)} alt="" />
          </span>
        </div>
      ) : null}
      {view?.banner ? <div className="arena-banner">{view.banner}</div> : null}

      {menuOpen ? (
        <ArenaMenu
          data={data}
          reducedMotion={reducedMotion}
          playing={playing}
          locked={locked}
          cycle={executedThisCycle}
          onClose={() => setMenuOpen(false)}
          onPass={() => void passRound()}
          onRetreat={() => void doRetreat()}
          onSkip={() => {
            setMenuOpen(false);
            void skipPlayback();
          }}
          onLeave={() => {
            setMenuOpen(false);
            goto('challenges');
          }}
        />
      ) : null}

      {hiddenZoom !== null ? (
        <Sheet title={`حركة الزعيم ${hiddenZoom + 1}`} onClose={() => setHiddenZoom(null)} className="hidden-zoom">
          <div className="hz">
            <CardBack big />
            <p>هذه الحركة لم تُكشف بعد. تنكشف لحظة تنفيذ الخانة {hiddenZoom + 1}، ولا يمكن معرفة البطاقة أو هدفها قبل ذلك.</p>
          </div>
        </Sheet>
      ) : null}

      {detail !== null ? (
        <Sheet
          title={detail === 'boss' ? (CATALOG.bossById.get(board.boss.bossId)?.name ?? '') : (CATALOG.heroById.get(board.heroes[detail].heroId)?.name ?? '')}
          onClose={() => setDetail(null)}
          className="unit-details"
        >
          <p className="muted small">
            الجولة <Num>{board.round}</Num> · المرحلة <Num>{board.phase}</Num>
          </p>
          <ul>
            {unitDetailLines(detail === 'boss' ? board.boss : board.heroes[detail]).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </Sheet>
      ) : null}
    </div>
  );
}

function CardBack({ big }: { big?: boolean }) {
  return (
    <span className={`card-back ${big ? 'big' : ''}`} aria-hidden="true">
      <span className="cb-ring" />
      <span className="cb-q">؟</span>
    </span>
  );
}

function BossMoveCard({
  k,
  abilityId,
  flipIn,
  active,
  done,
  inspected,
  onTap,
  onZoom,
}: {
  k: number;
  /** null ما دامت الحركة مخفية: لا يصل معرّفها إلى الواجهة إطلاقًا. */
  abilityId: string | null;
  flipIn: boolean;
  active: boolean;
  done: boolean;
  inspected: boolean;
  onTap: () => void;
  onZoom: () => void;
}) {
  const tap = useTap(onTap, onZoom);
  const a = abilityId ? CATALOG.abilities.get(abilityId) : undefined;
  return (
    <div className={`bmove ${a ? 'role-boss' : 'role-hidden'} ${active ? 'active' : ''} ${done ? 'done' : ''} ${inspected ? 'inspected' : ''}`} data-slot={k + 1} style={{ gridArea: `b${k + 1}` }}>
      <button
        type="button"
        className={`card-img-btn ${a && flipIn ? 'flip-in' : ''}`}
        {...tap}
        aria-label={a ? `حركة الزعيم ${k + 1}: ${a.name}. لمسة لإظهار أهدافها، ولمستان للتكبير` : `حركة الزعيم ${k + 1}: غير مكشوفة بعد`}
        aria-pressed={a ? inspected : undefined}
      >
        {a ? <img src={displayUrl(a.image)} alt={a.name} draggable={false} /> : <CardBack />}
      </button>
      <span className="slot-no" aria-hidden="true">
        <Num>{k + 1}</Num>
      </span>
      <button className="sr-zoom" onClick={onZoom} aria-label={a ? `تكبير ${a.name}` : `تكبير حركة الزعيم ${k + 1} المخفية`}>
        <Icon name="zoom" size={14} />
      </button>
    </div>
  );
}

function PlanSlot({
  k,
  abilityId,
  name,
  ghost,
  targetImg,
  targetName,
  selected,
  moveTarget,
  active,
  done,
  locked,
  onTap,
  onZoom,
  onRemove,
}: {
  k: number;
  abilityId: string | null;
  name: string;
  ghost: boolean;
  targetImg: string | null;
  targetName: string | null;
  selected: boolean;
  moveTarget: boolean;
  active: boolean;
  done: boolean;
  locked: boolean;
  onTap: () => void;
  onZoom: () => void;
  onRemove: () => void;
}) {
  const tap = useTap(onTap, onZoom);
  const filled = !!abilityId && !ghost;
  const tint = abilityId ? abilityTint(abilityId) : null;
  return (
    <div
      className={`pslot ${filled ? 'filled' : ghost ? 'ghost' : 'vacant'} ${tint ? tintClass(tint) : ''} ${selected ? 'selected' : ''} ${moveTarget ? 'move-target' : ''} ${active ? 'active' : ''} ${done ? 'done' : ''}`}
      data-slot={k + 1}
      data-ability={filled ? (abilityId ?? undefined) : undefined}
      style={{ gridArea: `s${k + 1}` }}
    >
      <button
        type="button"
        className="card-img-btn"
        {...tap}
        aria-pressed={filled ? selected : undefined}
        aria-label={
          filled
            ? `الخانة ${k + 1}: ${name}${targetName ? `، الهدف ${targetName}` : ''}. لمسة لتحديدها ثم نقلها أو تغيير هدفها، ولمستان للتكبير`
            : ghost
              ? `الخانة ${k + 1}: ${name} بانتظار اختيار الهدف`
              : moveTarget
                ? `انقل البطاقة المحددة إلى الخانة ${k + 1}`
                : `الخانة ${k + 1} فارغة`
        }
      >
        {abilityId ? <img src={displayUrl(CATALOG.abilities.get(abilityId)!.image)} alt={name} draggable={false} /> : <span className="slot-orn" aria-hidden="true" />}
        {ghost ? <span className="ghost-cap">اختر الهدف</span> : null}
      </button>
      <span className="slot-no" aria-hidden="true">
        <Num>{k + 1}</Num>
      </span>
      {targetImg ? (
        <span className="slot-target" title={targetName ?? undefined} aria-hidden="true">
          <img src={targetImg} alt="" draggable={false} />
        </span>
      ) : null}
      {(filled || ghost) && !locked ? (
        <button
          type="button"
          className="slot-x"
          aria-label={ghost ? `إلغاء اختيار ${name}` : `إزالة ${name} من الخانة ${k + 1}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <Icon name="close" size={12} />
        </button>
      ) : null}
      {filled ? (
        <button className="sr-zoom" onClick={onZoom} aria-label={`تكبير ${name}`}>
          <Icon name="zoom" size={14} />
        </button>
      ) : null}
    </div>
  );
}

function HandCard({
  abilityId,
  name,
  cost,
  tint,
  planned,
  pending,
  dim,
  onSelect,
  onZoom,
}: {
  abilityId: string;
  name: string;
  cost: number;
  tint: Tint;
  planned: number | null;
  pending: boolean;
  dim: boolean;
  onSelect: () => void;
  onZoom: () => void;
}) {
  const tap = useTap(onSelect, onZoom);
  return (
    <div className={`hand-card ${tintClass(tint)} ${planned ? 'planned' : ''} ${pending ? 'pending' : ''} ${dim ? 'dim' : ''}`} data-ability={abilityId}>
      <button
        type="button"
        className="card-img-btn"
        {...tap}
        aria-label={`${name} — ${cost} طاقة${planned ? ` — في الخانة ${planned}` : ''}. لمسة للاختيار، ولمستان للتكبير`}
        aria-pressed={!!planned || pending}
      >
        <img src={displayUrl(CATALOG.abilities.get(abilityId)!.image)} alt={name} draggable={false} />
        {planned ? (
          <span className="plan-badge">
            <Num>{planned}</Num>
          </span>
        ) : null}
      </button>
      <button className="sr-zoom" onClick={onZoom} aria-label={`تكبير ${name}`}>
        <Icon name="zoom" size={14} />
      </button>
    </div>
  );
}
