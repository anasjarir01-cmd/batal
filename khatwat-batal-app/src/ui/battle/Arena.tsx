// ساحة القتال بالترتيب الإلزامي من أعلى لأسفل: بانر الزعيم، حركاته الثلاث، خطة اللاعب
// (زر التنفيذ يسارًا ومؤشر الطاقة يمينًا)، اليد، الأبطال. لا شريط تنقل ولا ترويسة أثناء المعركة.
// البطاقات تُحمل بإمساك قصير وتُسحب إلى أي خانة؛ لمستان تكبّران. القواعد والأرقام كلها من المحرك دون تغيير.
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
import { useCardGesture, useTap, type DragStart, type TapSource } from './useTap';
import { VfxLayer, type VfxHandle } from './Vfx';

interface View {
  board: BoardSnapshot;
  revealed: number[];
  activeSlot: number | null;
  doneSlots: number[];
  zoom: { player?: string; boss: string } | null;
  banner: string | null;
}

/**
 * الخطة أثناء التحضير: ثلاث خانات مستقلة (قد تكون الأولى فارغة مؤقتًا).
 * عند التنفيذ يجب ألا يسبق بطاقةً فراغ، فتُرسل للمحرك كما هي: 1، أو 1 و2، أو 1 و2 و3.
 */
type Slots = Array<PlannedCard | null>;
const EMPTY_SLOTS: Slots = [null, null, null];

/** وضع التفاعل الحالي في الساحة. */
type Mode =
  | { kind: 'idle' }
  /** بطاقة أُسقطت في خانة وتنتظر اختيار هدفها؛ طاقتها محجوزة، والإلغاء يعيد كل شيء. */
  | { kind: 'target'; cardId: string; slot: number }
  /** بطاقة مخططة محددة: يُغيَّر هدفها بلمس بطل، أو تُنقل بلمس خانة أخرى. */
  | { kind: 'slot'; index: number }
  /** وضع بطاقة من اليد بلوحة المفاتيح: اختر الخانة. */
  | { kind: 'carry'; cardId: string }
  /** حركة زعيم ظاهرة محددة: أهدافها مُعلَّمة على الأبطال. */
  | { kind: 'boss'; k: number };

/** بطاقة محمولة بالإصبع. */
interface Drag {
  cardId: string;
  abilityId: string;
  /** الخانة التي حُملت منها، أو null إذا كانت من اليد. */
  from: number | null;
  over: number | null;
  ok: boolean;
  returning: boolean;
}

const IDLE: Mode = { kind: 'idle' };
const progressMemo = new Map<string, number>();
type Draft = { key: string; slots: Slots };
let draftMemo: Draft | null = null;

function compact(s: Slots): PlannedCard[] {
  return s.filter((p): p is PlannedCard => !!p);
}

/** أول خانة فارغة تسبق بطاقة (فراغ وسط الخطة)، أو null. */
function gapBefore(s: Slots): number | null {
  for (let k = 0; k < s.length; k++) if (!s[k] && s.slice(k + 1).some(Boolean)) return k;
  return null;
}

function padSlots(plan: PlannedCard[]): Slots {
  return Array.from({ length: PLAN_SLOTS }, (_, k) => plan[k] ?? null);
}

function readDraft(d: unknown, key: string): Slots | null {
  const x = d as { key?: string; slots?: Slots; plan?: PlannedCard[] } | undefined;
  if (!x || x.key !== key) return null;
  if (Array.isArray(x.slots) && x.slots.length === PLAN_SLOTS) return x.slots.map((p) => p ?? null);
  if (Array.isArray(x.plan)) return padSlots(x.plan); // مسودة من النسخة السابقة
  return null;
}

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

const cardCost = (st: BattleState, id: string) => CATALOG.abilities.get(st.cards[id].abilityId)?.cost ?? 0;
const usedOf = (st: BattleState, s: Slots) => compact(s).reduce((sum, p) => sum + cardCost(st, p.cardId), 0);

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
  const [flash, setFlash] = useState<string | null>(null);
  const [gapPulse, setGapPulse] = useState(0);
  const [drag, setDrag] = useState<Drag | null>(null);
  const updateReady = usePwa().updateReady;

  // ——— الخطة (مسودة محفوظة لا تؤثر في الحساب) ———
  const draftKey = `${live.battleId}:${live.round}`;
  const [slots, setSlots] = useState<Slots>(() => {
    // آخر مسودة محفوظة: من الذاكرة إن خرج اللاعب من الساحة وعاد، وإلا من التخزين بعد إعادة التحميل
    const s = readDraft(draftMemo?.key === draftKey ? draftMemo : data.meta.battleDraft, draftKey);
    if (s && validatePlan(live, compact(s)) === null) return s;
    return EMPTY_SLOTS;
  });
  // مراجع لأحدث قيمة: اللمسة الواحدة والسحب يُنفَّذان خارج دورة العرض، فلا يجوز أن يقرآ خطة قديمة.
  const slotsRef = useRef(slots);
  const modeRef = useRef(mode);
  const liveRef = useRef(live);
  const lockedRef = useRef(false);
  const dragLockRef = useRef(false);
  slotsRef.current = slots;
  modeRef.current = mode;
  liveRef.current = live;
  const commitSlots = (next: Slots) => {
    slotsRef.current = next;
    setSlots(next);
  };
  const setModeNow = (m: Mode) => {
    modeRef.current = m;
    setMode(m);
  };
  const flashTimer = useRef<number | null>(null);
  const showFlash = (text: string) => {
    setFlash(text);
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 2400);
  };

  const planKeyRef = useRef(draftKey);
  useEffect(() => {
    if (planKeyRef.current !== draftKey) {
      planKeyRef.current = draftKey;
      commitSlots(EMPTY_SLOTS);
      setModeNow(IDLE);
    }
  }, [draftKey]);
  useEffect(() => {
    draftMemo = { key: draftKey, slots };
    void setMeta(getDb(), 'battleDraft', draftMemo).catch(() => undefined);
  }, [slots, draftKey]);

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
  const shownSlots: Slots = playing && exec ? padSlots(exec.plan) : slots;
  const bossPlan: BossAction[] = shownState.bossPlan;
  const planIds = new Set(compact(shownSlots).map((p) => p.cardId));
  const hand = playing && exec ? exec.before.hand.filter((id) => !planIds.has(id)) : live.hand;
  const pendingCard = mode.kind === 'target' ? mode.cardId : null;
  // طاقة البطاقة التي تنتظر هدفها محجوزة حتى يُختار الهدف أو يُلغى الوضع
  const remaining = ENERGY_PER_ROUND - usedOf(shownState, shownSlots) - (pendingCard ? cardCost(live, pendingCard) : 0);
  const locked = playing || busy;
  lockedRef.current = locked;
  const planned = compact(slots);
  const planError = locked ? null : validatePlan(live, planned);
  const gap = locked ? null : gapBefore(slots);
  const canExecute = !locked && planned.length > 0 && planError === null && mode.kind !== 'target';
  const visibleMove = (k: number) => !bossPlan[k].hidden || (view?.revealed.includes(k) ?? false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modeRef.current.kind !== 'idle') setModeNow(IDLE);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ——— قواعد الخطة (تقرأ دائمًا أحدث حالة عبر المراجع) ———
  /** وضع بطاقة من اليد في الخانة k. يعيد false إذا رُفضت، والخطة والطاقة كما هما. */
  function placeFromHand(cardId: string, k: number): boolean {
    if (lockedRef.current) return false;
    const st = liveRef.current;
    const cur = slotsRef.current;
    const a = CATALOG.abilities.get(st.cards[cardId].abilityId)!;
    if (cur.some((p) => p?.cardId === cardId)) return false; // لا نسخة ثانية من البطاقة نفسها
    if (cur[k]) {
      toast(`الخانة ${k + 1} مشغولة؛ أزل بطاقتها بزر × أو انقلها أولًا`, 'info');
      return false;
    }
    const left = ENERGY_PER_ROUND - usedOf(st, cur);
    if ((a.cost ?? 0) > left) {
      toast(`الطاقة لا تكفي: ${a.name} تحتاج ${a.cost} والمتاح ${left}`, 'info');
      return false;
    }
    if (needsTarget(st, cardId)) {
      if (!legalTargets(st, cardId).length) {
        toast(a.heroTarget === 'ally-other' ? 'لا يوجد حليف آخر حي لهذه القدرة' : 'لا يوجد هدف حي', 'info');
        return false;
      }
      setModeNow({ kind: 'target', cardId, slot: k });
      sfx.select();
      return true;
    }
    const next = cur.slice();
    next[k] = { cardId };
    commitSlots(next);
    setModeNow(IDLE);
    sfx.select();
    return true;
  }

  /** نقل بطاقة مخططة إلى خانة فارغة، أو تبادل خانتين مع بقاء هدف كل بطاقة. بلا أي كلفة طاقة. */
  function moveSlot(from: number, to: number) {
    if (lockedRef.current || from === to) return;
    const cur = slotsRef.current;
    if (!cur[from]) return;
    const next = cur.slice();
    [next[from], next[to]] = [next[to], next[from]];
    commitSlots(next);
    setModeNow(IDLE);
    sfx.select();
  }

  function removeSlot(k: number) {
    if (lockedRef.current) return;
    const cur = slotsRef.current;
    if (!cur[k]) return;
    const next = cur.slice();
    next[k] = null;
    commitSlots(next);
    setModeNow(IDLE);
    sfx.deselect();
  }

  function cancelPending() {
    if (modeRef.current.kind === 'target') {
      setModeNow(IDLE);
      sfx.deselect();
    }
  }

  function tapHand(id: string, src: TapSource) {
    if (lockedRef.current) return;
    const at = slotsRef.current.findIndex((p) => p?.cardId === id);
    if (at >= 0) return showFlash(`هذه البطاقة في الخانة ${at + 1}؛ اسحبها من الخطة لنقلها أو أزلها بزر ×`);
    if (modeRef.current.kind === 'target') return showFlash('اختر هدفًا للبطاقة المعلقة أو ألغها أولًا');
    if (src === 'key') {
      // لوحة المفاتيح وقارئ الشاشة: حمل البطاقة ثم اختيار الخانة
      setModeNow({ kind: 'carry', cardId: id });
      sfx.select();
      return;
    }
    showFlash('أمسك البطاقة قليلًا ثم اسحبها إلى إحدى خانات الخطة');
  }

  function tapHero(slot: number) {
    const st = liveRef.current;
    const cur = slotsRef.current;
    const m = modeRef.current;
    if (!lockedRef.current && m.kind === 'target') {
      if (legalTargets(st, m.cardId).includes(slot) && !cur[m.slot]) {
        const next = cur.slice();
        next[m.slot] = { cardId: m.cardId, target: slot };
        commitSlots(next);
        setModeNow(IDLE);
        sfx.select();
      }
      return;
    }
    if (!lockedRef.current && m.kind === 'slot') {
      const p = cur[m.index];
      if (p && needsTarget(st, p.cardId) && legalTargets(st, p.cardId).includes(slot)) {
        commitSlots(cur.map((q, i) => (i === m.index && q ? { ...q, target: slot } : q)));
        setModeNow(IDLE);
        sfx.select();
        return;
      }
    }
    setDetail(slot);
  }

  function tapSlot(k: number) {
    if (lockedRef.current) return;
    const cur = slotsRef.current;
    const m = modeRef.current;
    if (m.kind === 'target') return;
    if (m.kind === 'carry') {
      if (placeFromHand(m.cardId, k) && modeRef.current.kind === 'carry') setModeNow(IDLE);
      return;
    }
    if (m.kind === 'slot' && cur[m.index]) {
      if (k === m.index) {
        setModeNow(IDLE);
        sfx.deselect();
      } else moveSlot(m.index, k);
      return;
    }
    if (cur[k]) {
      setModeNow({ kind: 'slot', index: k });
      sfx.select();
    } else showFlash(`اسحب بطاقة من يدك إلى الخانة ${k + 1}`);
  }

  function tapBoss(k: number) {
    if (!visibleMove(k)) {
      toast(`حركة الزعيم ${k + 1} تُكشف لحظة تنفيذ خانتها`, 'info');
      return;
    }
    const m = modeRef.current;
    if (m.kind === 'target' || m.kind === 'carry') return;
    setModeNow(m.kind === 'boss' && m.k === k ? IDLE : { kind: 'boss', k });
  }

  function zoomBoss(k: number) {
    if (!visibleMove(k)) return setHiddenZoom(k);
    openOverlay({ kind: 'card', abilityId: bossPlan[k].abilityId });
  }

  // ——— السحب والإفلات ———
  const ghostRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; w: number; h: number; ox: number; oy: number; rects: Array<DOMRect | null>; info: Drag } | null>(null);
  const placeGhost = () => {
    const d = dragRef.current;
    const g = ghostRef.current;
    if (!d || !g) return;
    g.style.width = `${d.w}px`;
    g.style.height = `${d.h}px`;
    g.style.transform = `translate3d(${d.x - d.w / 2}px, ${d.y - d.h * 0.62}px, 0)`;
  };

  function dropCheck(info: Drag, k: number | null): boolean {
    if (k === null) return false;
    const cur = slotsRef.current;
    if (info.from !== null) return k !== info.from;
    const left = ENERGY_PER_ROUND - usedOf(liveRef.current, cur);
    return !cur[k] && cardCost(liveRef.current, info.cardId) <= left;
  }

  /** إمساك مرفوض: الإصبع نفسه لا يصفّح اليد حتى يُرفع، فلا يتحرك شيء دون قصد. */
  function holdRefused(pointerId: number) {
    dragLockRef.current = true;
    const release = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      if (!dragRef.current) dragLockRef.current = false;
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return false;
  }

  function beginDrag(cardId: string, from: number | null, s: DragStart): boolean {
    if (dragRef.current) return false;
    if (lockedRef.current) return holdRefused(s.pointerId);
    const m = modeRef.current;
    if (m.kind === 'target') {
      showFlash('اختر هدفًا للبطاقة المعلقة أو ألغها أولًا');
      return holdRefused(s.pointerId);
    }
    const cur = slotsRef.current;
    if (from === null) {
      const at = cur.findIndex((p) => p?.cardId === cardId);
      if (at >= 0) {
        showFlash(`هذه البطاقة في الخانة ${at + 1}؛ اسحبها من الخطة لنقلها`);
        return holdRefused(s.pointerId);
      }
    } else if (cur[from]?.cardId !== cardId) return false;
    const root = rootRef.current;
    if (!root) return false;
    const rects = Array.from({ length: PLAN_SLOTS }, (_, k) => root.querySelector<HTMLElement>(`.pslot[data-slot="${k + 1}"]`)?.getBoundingClientRect() ?? null);
    const src = s.el.getBoundingClientRect();
    const info: Drag = { cardId, abilityId: liveRef.current.cards[cardId].abilityId, from, over: null, ok: false, returning: false };
    dragRef.current = { pointerId: s.pointerId, x: s.x, y: s.y, w: src.width * 1.06, h: src.height * 1.06, ox: src.left + src.width / 2, oy: src.top + src.height * 0.62 * 1.06 - src.height * 0.03, rects, info };
    dragLockRef.current = true;
    setModeNow(IDLE);
    setDrag(info);
    sfx.select();
    navigator.vibrate?.(12);

    const hit = (x: number, y: number) => {
      const d = dragRef.current!;
      for (let k = 0; k < d.rects.length; k++) {
        const r = d.rects[k];
        if (r && x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 8 && y <= r.bottom + 8) return k;
      }
      return null;
    };
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId || d.info.returning) return;
      e.preventDefault();
      d.x = e.clientX;
      d.y = e.clientY;
      placeGhost();
      let over = hit(e.clientX, e.clientY);
      if (over !== null && over === d.info.from) over = null;
      if (over !== d.info.over) {
        d.info = { ...d.info, over, ok: dropCheck(d.info, over) };
        setDrag(d.info);
      }
    };
    const finish = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      dragLockRef.current = false;
    };
    const flyBack = () => {
      const d = dragRef.current;
      if (!d) return;
      d.info = { ...d.info, over: null, returning: true };
      setDrag(d.info);
      d.x = d.ox;
      d.y = d.oy;
      requestAnimationFrame(placeGhost);
      window.setTimeout(() => {
        dragRef.current = null;
        setDrag(null);
      }, 200);
    };
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      finish();
      let over = hit(e.clientX, e.clientY);
      if (over !== null && over === d.info.from) over = null;
      const info = d.info;
      if (over === null) return flyBack();
      if (info.from !== null) {
        dragRef.current = null;
        setDrag(null);
        moveSlot(info.from, over);
        return;
      }
      if (placeFromHand(info.cardId, over)) {
        dragRef.current = null;
        setDrag(null);
      } else flyBack();
    };
    const onCancel = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      finish();
      flyBack();
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return true;
  }

  // يبدأ العرض وأصبع ما زال يحمل بطاقة: تعود البطاقة دون أي تغيير
  useEffect(() => {
    if (locked && dragRef.current && !dragRef.current.info.returning) {
      dragRef.current = null;
      dragLockRef.current = false;
      setDrag(null);
    }
  }, [locked]);

  async function execute() {
    if (lockedRef.current) return;
    const cur = slotsRef.current;
    const list = compact(cur);
    if (!list.length || modeRef.current.kind === 'target') return;
    const g = gapBefore(cur);
    if (g !== null) {
      setGapPulse((n) => n + 1);
      toast(`أكمل ترتيب الخطة: الخانة ${g + 1} فارغة قبل بطاقة. ضع فيها بطاقة أو انقل البطاقات إليها.`, 'error');
      return;
    }
    const err = validatePlan(liveRef.current, list);
    if (err) return toast(err, 'error');
    lockedRef.current = true;
    setBusy(true);
    setModeNow(IDLE);
    try {
      // لا فراغ قبل أي بطاقة: الخانة k في الواجهة هي الخانة k في المحرك
      await act((db) => commitRound(db, rec.rev, list));
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
      body: <p>لن تُلعب أي بطاقة هذه الجولة{compact(slotsRef.current).length ? ' (ولا البطاقات الموضوعة في الخطة)' : ''}، وسينفذ الزعيم حركاته الثلاث.</p>,
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
  const selSlot = mode.kind === 'slot' && shownSlots[mode.index] ? mode.index : null;
  const selPlanned = selSlot !== null ? (shownSlots[selSlot] ?? undefined) : undefined;
  const selNeedsTarget = !!selPlanned && needsTarget(live, selPlanned.cardId);
  const inspected = mode.kind === 'boss' && visibleMove(mode.k) ? bossPlan[mode.k] : undefined;
  const carryCard = mode.kind === 'carry' ? mode.cardId : null;

  function heroMark(slot: number): HeroMark {
    if (pendingCard) return legalTargets(live, pendingCard).includes(slot) ? 'selectable' : 'dimmed';
    if (selPlanned && selNeedsTarget) {
      if (selPlanned.target === slot) return 'current';
      return legalTargets(live, selPlanned.cardId).includes(slot) ? 'selectable' : null;
    }
    if (inspected?.targets.includes(slot)) return 'threat';
    return null;
  }

  /** حالة كل خانة أثناء الحمل: وجهة صالحة، أو تحت الإصبع صالحة/مرفوضة. */
  function dropState(k: number): 'candidate' | 'over' | 'bad' | null {
    const d = drag ?? (carryCard ? ({ cardId: carryCard, abilityId: '', from: null, over: null, ok: false, returning: false } as Drag) : null);
    if (!d || d.returning || k === d.from) return null;
    if (drag && d.over === k) return d.ok ? 'over' : 'bad';
    return dropCheck(d, k) ? 'candidate' : null;
  }

  let hint: string | null = null;
  if (pendingCard) hint = `اختر هدفًا لـ«${CATALOG.abilities.get(live.cards[pendingCard].abilityId)?.name}» من الأبطال، أو × للإلغاء`;
  else if (drag && !drag.returning) hint = drag.from === null ? 'أفلت البطاقة فوق خانة فارغة' : 'أفلتها فوق خانة فارغة لنقلها، أو فوق بطاقة لتبادلهما';
  else if (carryCard) hint = 'اختر الخانة التي توضع فيها البطاقة (Esc للإلغاء)';
  else if (selPlanned) hint = selNeedsTarget ? 'المس بطلًا لتغيير الهدف، أو المس خانة أخرى للنقل' : 'المس خانة أخرى للنقل أو التبادل';
  else if (inspected && mode.kind === 'boss') hint = inspected.targets.length ? `أهداف حركة الزعيم ${mode.k + 1} مُعلَّمة على الأبطال` : `حركة الزعيم ${mode.k + 1} تخصّه هو`;
  else if (flash) hint = flash;
  else if (gap !== null) hint = `الخانة ${gap + 1} فارغة قبل بطاقة؛ أكمل ترتيب الخطة قبل التنفيذ`;

  return (
    <div className={`arena ${playing ? 'is-playing' : ''} ${mode.kind !== 'idle' ? `mode-${mode.kind}` : ''} ${drag ? 'is-dragging' : ''}`} ref={rootRef} data-testid="arena">
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
            const p = shownSlots[k];
            const ghost = !p && mode.kind === 'target' && mode.slot === k ? mode.cardId : null;
            const cardId = p?.cardId ?? ghost;
            const a = cardId ? CATALOG.abilities.get(shownState.cards[cardId].abilityId) : undefined;
            const targetHero = p?.target !== undefined ? shownState.heroes[p.target] : undefined;
            return (
              <PlanSlot
                key={k}
                k={k}
                cardId={p?.cardId ?? null}
                abilityId={a?.id ?? null}
                name={a?.name ?? ''}
                ghost={!!ghost}
                targetImg={targetHero ? displayUrl(heroImageForLevel(CATALOG.heroById.get(targetHero.heroId)!, cosmeticLevel(wins[targetHero.heroId] ?? 0))) : null}
                targetName={targetHero ? heroShortName(targetHero.heroId) : null}
                selected={selSlot === k}
                moveTarget={selSlot !== null && selSlot !== k}
                drop={dropState(k)}
                carrying={!!drag && !drag.returning && drag.from === k}
                gap={gap === k}
                gapPulse={gap === k ? gapPulse : 0}
                active={view?.activeSlot === k}
                done={!!view?.doneSlots.includes(k)}
                locked={locked}
                onTap={() => tapSlot(k)}
                onZoom={() => (p && a ? openOverlay({ kind: 'card', abilityId: a.id, cardId: p.cardId, target: p.target }) : a ? openOverlay({ kind: 'card', abilityId: a.id }) : undefined)}
                onRemove={() => (ghost ? cancelPending() : removeSlot(k))}
                onDrag={(s) => (p ? beginDrag(p.cardId, k, s) : false)}
              />
            );
          })}
          <button
            className={`exec-btn ${busy ? 'busy' : ''} ${gap !== null && canExecute ? 'has-gap' : ''}`}
            onClick={() => void execute()}
            disabled={!canExecute}
            data-testid="execute"
            aria-label={!planned.length ? 'تنفيذ: ضع بطاقة واحدة على الأقل في الخطة' : gap !== null ? `تنفيذ: الخانة ${gap + 1} فارغة قبل بطاقة` : 'تنفيذ الجولة'}
            title={planError ?? undefined}
          >
            <Icon name="swords" size={20} />
            <span className="exec-label">تنفيذ</span>
          </button>
        </section>

        {/* 4 — يد القدرات: أربع بطاقات ظاهرة، والسحب الأفقي يكشف الباقي؛ الإمساك القصير يحمل البطاقة */}
        <HandPager
          items={hand}
          resetKey={`${live.round}:${playing ? 'play' : 'plan'}`}
          blockRef={dragLockRef}
          render={(id) => {
            const a = CATALOG.abilities.get(shownState.cards[id].abilityId)!;
            const idx = shownSlots.findIndex((p) => p?.cardId === id);
            const isPlanned = idx >= 0;
            const tooCostly = !isPlanned && (a.cost ?? 0) > remaining;
            return (
              <HandCard
                abilityId={a.id}
                name={a.name}
                cost={a.cost ?? 0}
                tint={abilityTint(a.id)}
                planned={isPlanned ? idx + 1 : null}
                pending={pendingCard === id || carryCard === id}
                carrying={!!drag && !drag.returning && drag.from === null && drag.cardId === id}
                dim={tooCostly || locked}
                onTap={(src) => tapHand(id, src)}
                onZoom={() => openOverlay({ kind: 'card', abilityId: a.id, cardId: id, target: isPlanned ? shownSlots[idx]?.target : undefined })}
                onDrag={(s) => beginDrag(id, null, s)}
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

      {drag ? (
        <div className={`drag-ghost ${tintClass(abilityTint(drag.abilityId))} ${drag.returning ? 'returning' : ''} ${drag.over !== null ? (drag.ok ? 'over-ok' : 'over-bad') : ''}`} ref={(el) => {
          ghostRef.current = el;
          placeGhost();
        }} aria-hidden="true" data-testid="drag-ghost">
          <img src={displayUrl(CATALOG.abilities.get(drag.abilityId)!.image)} alt="" draggable={false} />
        </div>
      ) : null}

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
  cardId,
  abilityId,
  name,
  ghost,
  targetImg,
  targetName,
  selected,
  moveTarget,
  drop,
  carrying,
  gap,
  gapPulse,
  active,
  done,
  locked,
  onTap,
  onZoom,
  onRemove,
  onDrag,
}: {
  k: number;
  cardId: string | null;
  abilityId: string | null;
  name: string;
  ghost: boolean;
  targetImg: string | null;
  targetName: string | null;
  selected: boolean;
  moveTarget: boolean;
  drop: 'candidate' | 'over' | 'bad' | null;
  carrying: boolean;
  gap: boolean;
  gapPulse: number;
  active: boolean;
  done: boolean;
  locked: boolean;
  onTap: () => void;
  onZoom: () => void;
  onRemove: () => void;
  onDrag: (s: DragStart) => boolean;
}) {
  const filled = !!cardId && !ghost;
  const g = useCardGesture({ onTap: () => onTap(), onDoubleTap: onZoom, onDrag: filled && !locked ? onDrag : undefined, dragOnMove: true });
  const tint = abilityId ? abilityTint(abilityId) : null;
  return (
    <div
      className={`pslot ${filled ? 'filled' : ghost ? 'ghost' : 'vacant'} ${tint ? tintClass(tint) : ''} ${selected ? 'selected' : ''} ${moveTarget ? 'move-target' : ''} ${drop ? `drop-${drop}` : ''} ${carrying ? 'carrying' : ''} ${gap ? 'gap' : ''} ${active ? 'active' : ''} ${done ? 'done' : ''}`}
      data-slot={k + 1}
      data-ability={filled ? (abilityId ?? undefined) : undefined}
      data-card={filled ? (cardId ?? undefined) : undefined}
      style={{ gridArea: `s${k + 1}` }}
    >
      <button
        type="button"
        className="card-img-btn"
        {...g}
        aria-pressed={filled ? selected : undefined}
        aria-label={
          filled
            ? `الخانة ${k + 1}: ${name}${targetName ? `، الهدف ${targetName}` : ''}. اسحبها لنقلها، ولمسة لتغيير هدفها، ولمستان للتكبير`
            : ghost
              ? `الخانة ${k + 1}: ${name} بانتظار اختيار الهدف`
              : drop === 'candidate' || moveTarget
                ? `ضع البطاقة في الخانة ${k + 1}`
                : `الخانة ${k + 1} فارغة`
        }
      >
        {abilityId ? <img src={displayUrl(CATALOG.abilities.get(abilityId)!.image)} alt={name} draggable={false} /> : <span className="slot-orn" aria-hidden="true" />}
        {ghost ? <span className="ghost-cap">اختر الهدف</span> : null}
      </button>
      <span className="slot-no" aria-hidden="true">
        <Num>{k + 1}</Num>
      </span>
      {gap && gapPulse ? <span className="gap-pulse" key={gapPulse} aria-hidden="true" /> : null}
      {targetImg ? (
        <span className="slot-target" title={targetName ?? undefined} aria-hidden="true">
          <img src={targetImg} alt="" draggable={false} />
        </span>
      ) : null}
      {(filled || ghost) && !locked ? (
        <button
          type="button"
          className="slot-x"
          aria-label={ghost ? `إلغاء وضع ${name}` : `إزالة ${name} من الخانة ${k + 1}`}
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
  carrying,
  dim,
  onTap,
  onZoom,
  onDrag,
}: {
  abilityId: string;
  name: string;
  cost: number;
  tint: Tint;
  planned: number | null;
  pending: boolean;
  carrying: boolean;
  dim: boolean;
  onTap: (src: TapSource) => void;
  onZoom: () => void;
  onDrag: (s: DragStart) => boolean;
}) {
  const g = useCardGesture({ onTap, onDoubleTap: onZoom, onDrag });
  return (
    <div className={`hand-card ${tintClass(tint)} ${planned ? 'planned' : ''} ${pending ? 'pending' : ''} ${carrying ? 'carrying' : ''} ${dim ? 'dim' : ''}`} data-ability={abilityId}>
      <button
        type="button"
        className="card-img-btn"
        {...g}
        aria-label={`${name} — ${cost} طاقة${planned ? ` — في الخانة ${planned}` : ''}. أمسكها ثم اسحبها إلى خانة، ولمستان للتكبير`}
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
