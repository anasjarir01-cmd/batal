// ساحة القتال بالترتيب الإلزامي من أعلى لأسفل: بانر الزعيم، حركاته الثلاث، خطة اللاعب، اليد، الأبطال.
import { useEffect, useMemo, useRef, useState } from 'react';
import { sfx, sfxForFamily } from '../../audio/sfx';
import { CATALOG, displayUrl } from '../../catalog';
import { legalTargets, needsTarget, validatePlan, ENERGY_PER_ROUND, PLAN_SLOTS } from '../../engine/battle/engine';
import type { BattleState, BoardSnapshot, BossAction, PlannedCard } from '../../engine/battle/types';
import { act, getDb } from '../../store/appStore';
import { commitRound, OpError, retreatBattle, setMeta, setPlaybackCursor, type AppData } from '../../store/ops';
import { Num, Sheet } from '../components/common';
import { confirmDialog, toast } from '../components/dialogs';
import { Icon } from '../components/Icon';
import { openOverlay } from '../nav';
import { HandPager } from './HandPager';
import { fxForGroup, groupEvents } from './playback';
import { BossBanner, HeroToken, heroShortName, unitDetailLines } from './Units';
import { VfxLayer, type VfxHandle } from './Vfx';

interface View {
  board: BoardSnapshot;
  revealed: number[];
  activeSlot: number | null;
  doneSlots: number[];
  zoom: { player?: string; boss: string } | null;
  banner: string | null;
}

const progressMemo = new Map<string, number>();

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
  const [showLog, setShowLog] = useState(false);
  const [targeting, setTargeting] = useState<{ cardId: string; index?: number } | null>(null);
  const [detail, setDetail] = useState<'boss' | number | null>(null);

  // ——— الخطة (مسودة محفوظة لا تؤثر في الحساب) ———
  const draftKey = `${live.battleId}:${live.round}`;
  const [plan, setPlan] = useState<PlannedCard[]>(() => {
    const d = data.meta.battleDraft as { key: string; plan: PlannedCard[] } | undefined;
    if (d?.key === draftKey && validatePlan(live, d.plan) === null) return d.plan;
    return [];
  });
  const planKeyRef = useRef(draftKey);
  useEffect(() => {
    if (planKeyRef.current !== draftKey) {
      planKeyRef.current = draftKey;
      setPlan([]);
      setTargeting(null);
    }
  }, [draftKey]);
  useEffect(() => {
    void setMeta(getDb(), 'battleDraft', { key: draftKey, plan }).catch(() => undefined);
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
  const cost = (id: string) => CATALOG.abilities.get(shownState.cards[id].abilityId)?.cost ?? 0;
  const used = shownPlan.reduce((s, p) => s + cost(p.cardId), 0);
  const remaining = ENERGY_PER_ROUND - used;
  const locked = playing || busy;

  // ——— تفاعل التخطيط ———
  function selectCard(id: string) {
    if (locked) return;
    const existing = plan.findIndex((p) => p.cardId === id);
    if (existing >= 0) {
      setPlan(plan.filter((_, i) => i !== existing));
      sfx.deselect();
      return;
    }
    const a = CATALOG.abilities.get(live.cards[id].abilityId)!;
    if (plan.length >= PLAN_SLOTS) return toast('ثلاث بطاقات كحد أقصى في الجولة', 'info');
    if ((a.cost ?? 0) > remaining) return toast(`الطاقة لا تكفي: ${a.name} تحتاج ${a.cost} والمتاح ${remaining}`, 'info');
    if (needsTarget(live, id)) {
      const lt = legalTargets(live, id);
      if (!lt.length) return toast(a.heroTarget === 'ally-other' ? 'لا يوجد حليف آخر حي لهذه القدرة' : 'لا يوجد هدف حي', 'info');
      setTargeting({ cardId: id });
      sfx.select();
      return;
    }
    setPlan([...plan, { cardId: id }]);
    sfx.select();
  }

  function chooseTarget(slot: number) {
    if (!targeting) return;
    const { cardId, index } = targeting;
    if (index !== undefined) setPlan(plan.map((p, i) => (i === index ? { ...p, target: slot } : p)));
    else setPlan([...plan, { cardId, target: slot }]);
    setTargeting(null);
    sfx.select();
  }

  function move(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= plan.length) return;
    const next = plan.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setPlan(next);
  }

  async function execute() {
    if (locked) return;
    const err = validatePlan(live, plan);
    if (err) return toast(err, 'error');
    if (!plan.length) {
      const ok = await confirmDialog({ title: 'تمرير الجولة؟', body: <p>لن تلعب أي بطاقة، والزعيم سينفذ حركاته الثلاث.</p>, confirmText: 'تمرير' });
      if (!ok) return;
    }
    setBusy(true);
    setTargeting(null);
    try {
      await act((db) => commitRound(db, rec.rev, plan));
      sfx.confirm();
    } catch (e) {
      toast(e instanceof OpError ? e.message : 'تعذر تنفيذ الجولة', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function doRetreat() {
    const ok = await confirmDialog({ title: 'الانسحاب من المعركة؟', body: <p>تنتهي المعركة دون انتصارات. لا توجد أي عقوبة.</p>, confirmText: 'انسحاب', tone: 'danger' });
    if (!ok) return;
    try {
      await act((db) => retreatBattle(db, rec.rev));
    } catch (e) {
      toast(e instanceof OpError ? e.message : 'تعذر الانسحاب', 'error');
    }
  }

  const targetLegal = targeting ? legalTargets(live, targeting.cardId) : [];
  const cycleStart = Math.floor((shownState.round - 1) / 3) * 3 + 1;
  const executedThisCycle = shownState.bossHistory.filter((h) => h.round >= cycleStart && h.round < shownState.round);

  return (
    <div className={`arena ${playing ? 'is-playing' : ''} ${targeting ? 'is-targeting' : ''}`} ref={rootRef} data-testid="arena">
      <VfxLayer ref={vfx} rootRef={rootRef} />

      {/* 1 — بانر الزعيم */}
      <BossBanner boss={board.boss} phase={board.phase} phase2Pending={board.phase2Pending} round={board.round} onDetails={() => setDetail('boss')} />

      {/* 2 — حركات الزعيم الثلاث */}
      <section className="row boss-moves" data-testid="boss-moves" aria-label="حركات الزعيم">
        {bossPlan.map((b, k) => {
          const visible = !b.hidden || (view?.revealed.includes(k) ?? false);
          const a = visible ? CATALOG.abilities.get(b.abilityId) : undefined;
          const active = view?.activeSlot === k;
          const done = view?.doneSlots.includes(k);
          return (
            <div key={k} className={`move-slot ${active ? 'active' : ''} ${done ? 'done' : ''}`} data-slot={k + 1}>
              <span className="slot-no">
                <Num>{k + 1}</Num>
              </span>
              {visible && a ? (
                <button className={`card-img-btn ${b.hidden ? 'flip-in' : ''}`} onClick={() => openOverlay({ kind: 'card', abilityId: a.id })} aria-label={`حركة الزعيم ${k + 1}: ${a.name}`}>
                  <img src={displayUrl(a.image)} alt={a.name} draggable={false} />
                </button>
              ) : (
                <div className="card-back" aria-label={`حركة الزعيم ${k + 1}: مخفية`} role="img">
                  <span>؟</span>
                </div>
              )}
              <div className="slot-side slot-targets">
                {visible ? (
                  b.targets.length ? (
                    b.targets.length === shownState.heroes.filter((h) => h.hp > 0).length && CATALOG.abilities.get(b.abilityId)?.bossTarget === 'all' ? (
                      <span className="tchip">الكل</span>
                    ) : (
                      b.targets.map((t) => (
                        <span key={t} className="tchip">
                          {heroShortName(shownState.heroes[t].heroId)}
                        </span>
                      ))
                    )
                  ) : (
                    <span className="tchip">نفسه</span>
                  )
                ) : (
                  <span className="tchip muted">مخفية</span>
                )}
              </div>
            </div>
          );
        })}
      </section>

      {/* 3 — خطة اللاعب */}
      <section className="row plan-row" data-testid="plan-row" aria-label="خطة اللاعب">
        {Array.from({ length: PLAN_SLOTS }, (_, k) => {
          const p = shownPlan[k];
          const a = p ? CATALOG.abilities.get(shownState.cards[p.cardId].abilityId) : undefined;
          const active = view?.activeSlot === k;
          const done = view?.doneSlots.includes(k);
          return (
            <div key={k} className={`move-slot plan-slot ${p ? 'filled' : 'empty'} ${active ? 'active' : ''} ${done ? 'done' : ''}`} data-slot={k + 1}>
              <span className="slot-no">
                <Num>{k + 1}</Num>
              </span>
              {p && a ? (
                <>
                  <button className="card-img-btn" onClick={() => openOverlay({ kind: 'card', abilityId: a.id, cardId: p.cardId, target: p.target })} aria-label={`الخانة ${k + 1}: ${a.name}`}>
                    <img src={displayUrl(a.image)} alt={a.name} draggable={false} />
                  </button>
                  <div className="slot-side">
                  <div className="slot-targets">
                    {p.target !== undefined ? (
                      <button className="tchip link" disabled={locked} onClick={() => setTargeting({ cardId: p.cardId, index: k })} aria-label="تغيير الهدف">
                        ← {heroShortName(shownState.heroes[p.target].heroId)}
                      </button>
                    ) : (
                      <span className="tchip">{a.heroTarget === 'none' && a.effects.some((e) => e.target === 'boss') ? 'الزعيم' : 'تلقائي'}</span>
                    )}
                  </div>
                  {!locked ? (
                    <div className="slot-tools">
                      <button className="mini-btn" aria-label="تقديم" disabled={k === 0} onClick={() => move(k, -1)}>
                        <span className="flip-x">
                          <Icon name="back" size={14} />
                        </span>
                      </button>
                      <button className="mini-btn" aria-label="إزالة" onClick={() => setPlan(plan.filter((_, i) => i !== k))}>
                        <Icon name="close" size={14} />
                      </button>
                      <button className="mini-btn" aria-label="تأخير" disabled={k === shownPlan.length - 1} onClick={() => move(k, 1)}>
                        <Icon name="back" size={14} />
                      </button>
                    </div>
                  ) : null}
                  </div>
                </>
              ) : (
                <div className="card-empty">{k === shownPlan.length && !locked ? 'اختر بطاقة' : ''}</div>
              )}
            </div>
          );
        })}
      </section>

      {/* شريط التحكم قرب التخطيط */}
      <section className="control-bar">
        <span className="round-chip" aria-label={`الجولة ${board.round}`}>
          ج<Num>{board.round}</Num>
        </span>
        <span className="energy" aria-label={`الطاقة المتاحة ${remaining} من ${ENERGY_PER_ROUND}`}>
          ⚡ <Num>{remaining}/{ENERGY_PER_ROUND}</Num>
        </span>
        <button className="chip-btn small" onClick={() => setShowLog((v) => !v)} aria-expanded={showLog} aria-label="سجل بطاقات الزعيم المنفذة في هذه الدورة">
          المنفذة <Num>{executedThisCycle.length}/9</Num>
        </button>
        {playing ? (
          <button className="btn btn-ghost btn-small" onClick={() => void skipPlayback()}>
            تخطي العرض
          </button>
        ) : (
          <>
            <button className="icon-btn" aria-label="انسحاب" onClick={() => void doRetreat()} disabled={locked}>
              <Icon name="retreat" size={20} />
            </button>
            <button className="btn btn-primary execute-btn" onClick={() => void execute()} disabled={locked} data-testid="execute">
              {plan.length ? 'تنفيذ' : 'تمرير الجولة'}
            </button>
          </>
        )}
      </section>
      {showLog ? (
        <div className="boss-log" aria-label="البطاقات المنفذة في هذه الدورة">
          {executedThisCycle.length ? (
            executedThisCycle.map((h) => {
              const a = CATALOG.abilities.get(h.abilityId)!;
              return (
                <button key={`${h.round}-${h.slot}`} className="log-thumb" onClick={() => openOverlay({ kind: 'card', abilityId: a.id })} aria-label={a.name}>
                  <img src={displayUrl(a.image)} alt={a.name} />
                </button>
              );
            })
          ) : (
            <span className="muted small">لم تُنفذ أي بطاقة في هذه الدورة بعد.</span>
          )}
        </div>
      ) : null}
      {targeting ? (
        <div className="targeting-hint" role="status">
          اختر هدفًا لـ«{CATALOG.abilities.get(live.cards[targeting.cardId].abilityId)?.name}» من الأبطال بالأسفل
          <button className="btn btn-ghost btn-small" onClick={() => setTargeting(null)}>
            إلغاء
          </button>
        </div>
      ) : null}

      {/* 4 — يد القدرات */}
      <HandPager
        items={playing && exec ? [...hand] : hand}
        render={(id) => {
          const a = CATALOG.abilities.get(shownState.cards[id].abilityId)!;
          const idx = shownPlan.findIndex((p) => p.cardId === id);
          const planned = idx >= 0;
          const tooCostly = !planned && (a.cost ?? 0) > remaining;
          return (
            <HandCard
              abilityId={a.id}
              name={a.name}
              image={displayUrl(a.image)}
              cost={a.cost ?? 0}
              planned={planned ? idx + 1 : null}
              dim={tooCostly || locked}
              onSelect={() => selectCard(id)}
              onZoom={() => openOverlay({ kind: 'card', abilityId: a.id, cardId: id })}
            />
          );
        }}
      />

      {/* 5 — الأبطال الخمسة */}
      <section className="heroes-row" data-testid="heroes-row" aria-label="الأبطال">
        {board.heroes.map((h) => (
          <HeroToken
            key={h.slot}
            unit={h}
            wins={wins[h.heroId] ?? 0}
            selectable={!!targeting && targetLegal.includes(h.slot)}
            dimmed={!!targeting && !targetLegal.includes(h.slot)}
            onSelect={() => chooseTarget(h.slot)}
            onDetails={() => setDetail(h.slot)}
          />
        ))}
      </section>

      {view?.zoom ? (
        <div className="pair-zoom" aria-hidden="true">
          {view.zoom.player ? <img src={displayUrl(CATALOG.abilities.get(view.zoom.player)!.image)} alt="" /> : <div className="pair-empty">—</div>}
          <span className="vs">VS</span>
          <img src={displayUrl(CATALOG.abilities.get(view.zoom.boss)!.image)} alt="" />
        </div>
      ) : null}
      {view?.banner ? <div className="arena-banner">{view.banner}</div> : null}
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

function HandCard({
  abilityId,
  name,
  image,
  cost,
  planned,
  dim,
  onSelect,
  onZoom,
}: {
  abilityId: string;
  name: string;
  image: string;
  cost: number;
  planned: number | null;
  dim: boolean;
  onSelect: () => void;
  onZoom: () => void;
}) {
  const timer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };
  return (
    <div className={`hand-card ${planned ? 'planned' : ''} ${dim ? 'dim' : ''}`} data-ability={abilityId}>
      <button
        className="card-img-btn"
        aria-label={`${name} — ${cost} طاقة${planned ? ` — في الخانة ${planned}` : ''}`}
        aria-pressed={!!planned}
        onPointerDown={(e) => {
          longPressed.current = false;
          startPos.current = { x: e.clientX, y: e.clientY };
          clear();
          timer.current = window.setTimeout(() => {
            longPressed.current = true;
            onZoom();
          }, 520);
        }}
        onPointerMove={(e) => {
          if (startPos.current && Math.hypot(e.clientX - startPos.current.x, e.clientY - startPos.current.y) > 10) clear();
        }}
        onPointerUp={clear}
        onPointerCancel={clear}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => {
          if (longPressed.current) {
            longPressed.current = false;
            return;
          }
          onSelect();
        }}
      >
        <img src={image} alt={name} draggable={false} />
        {planned ? (
          <span className="plan-badge">
            <Num>{planned}</Num>
          </span>
        ) : null}
      </button>
      <button className="zoom-btn" onClick={onZoom} aria-label={`تكبير ${name}`}>
        <Icon name="zoom" size={14} />
      </button>
    </div>
  );
}
