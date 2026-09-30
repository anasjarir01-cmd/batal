import { useEffect, useMemo, useRef, useState } from 'react';
import { sfx } from '../../audio/sfx';
import { CATALOG, displayUrl, heroImageForLevel, ROLE_LABEL, ROLE_SLOT_ORDER } from '../../catalog';
import { cosmeticLevel } from '../../engine/economy';
import { Rng } from '../../engine/rng';
import { act } from '../../store/appStore';
import { cancelPrep, chooseBoss, confirmTeam, eligibleBosses, finishBattle, OpError, type AppData } from '../../store/ops';
import { Num } from '../components/common';
import { toast } from '../components/dialogs';
import { Icon } from '../components/Icon';
import { Arena } from './Arena';

/** معاينة توزيع الخانات لاختيار جزئي (نفس خوارزمية المحرك). */
function previewSlots(selected: string[]): Array<string | null> {
  const slots: Array<string | null> = Array(5).fill(null);
  const rest: string[] = [];
  for (const id of selected) {
    const idx = ROLE_SLOT_ORDER.indexOf(CATALOG.heroById.get(id)!.role);
    if (idx >= 0 && slots[idx] === null) slots[idx] = id;
    else rest.push(id);
  }
  for (const id of rest) {
    const f = slots.indexOf(null);
    if (f >= 0) slots[f] = id;
  }
  return slots;
}

function TeamSelect({ data }: { data: AppData }) {
  const owned = data.heroes.filter((h) => CATALOG.heroById.has(h.heroId));
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const slots = previewSlots(sel);
  const toggle = (id: string) => {
    if (sel.includes(id)) setSel(sel.filter((x) => x !== id));
    else if (sel.length < 5) setSel([...sel, id]);
    else toast('الفريق خمسة أبطال', 'info');
    sfx.select();
  };
  async function confirm() {
    if (sel.length !== 5 || busy) return;
    setBusy(true);
    try {
      await act((db) => confirmTeam(db, data.battle.rev, sel));
    } catch (e) {
      toast(e instanceof OpError ? e.message : 'تعذر تأكيد الفريق', 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page team-select">
      <section className="card pad">
        <h2>اختر خمسة أبطال</h2>
        <p className="muted small">يُوزَّعون تلقائيًا على خانات الأدوار من اليمين لليسار. لا يمكن تبديلهم بعد ظهور المرشحَين.</p>
        <div className="slot-preview">
          {slots.map((id, i) => (
            <div key={i} className={`slot-box ${id ? 'on' : ''}`}>
              {id ? <img src={displayUrl(CATALOG.heroById.get(id)!.levelImages[0])} alt="" /> : <Icon name="plus" />}
              <span>{ROLE_LABEL[ROLE_SLOT_ORDER[i]]}</span>
            </div>
          ))}
        </div>
      </section>
      <div className="hero-grid pick">
        {owned.map((o) => {
          const h = CATALOG.heroById.get(o.heroId)!;
          const on = sel.includes(h.id);
          return (
            <button key={h.id} className={`hero-card pickable ${on ? 'on' : ''}`} onClick={() => toggle(h.id)} aria-pressed={on}>
              <div className="portrait-frame">
                <img src={displayUrl(heroImageForLevel(h, cosmeticLevel(o.wins)))} alt="" draggable={false} />
                {on ? (
                  <span className="pick-no">
                    <Num>{sel.indexOf(h.id) + 1}</Num>
                  </span>
                ) : null}
              </div>
              <div className="hero-card-info">
                <strong>{h.name}</strong>
                <span className="muted small">
                  {ROLE_LABEL[h.role]} · <Num>{h.maxHp}</Num> حياة
                </span>
              </div>
            </button>
          );
        })}
      </div>
      <div className="sticky-actions">
        {owned.length === 5 && sel.length < 5 ? (
          <button className="btn btn-ghost" onClick={() => setSel(owned.map((o) => o.heroId))}>
            اختيار الكل
          </button>
        ) : null}
        <button className="btn btn-primary" disabled={sel.length !== 5 || busy} onClick={() => void confirm()} data-testid="confirm-team">
          تأكيد الفريق (<Num>{sel.length}/5</Num>)
        </button>
      </div>
    </div>
  );
}

const seenRoulette = new Set<string>();

function Roulette({ data, reducedMotion }: { data: AppData; reducedMotion: boolean }) {
  const prep = data.battle.prep!;
  const eligible = eligibleBosses(data.bosses);
  const [phase, setPhase] = useState<'spin' | 'done'>(() => (seenRoulette.has(prep.prepId) || reducedMotion ? 'done' : 'spin'));
  const [busy, setBusy] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  // شريط للعرض فقط؛ النتيجة محسوبة ومحفوظة مسبقًا في prep.candidates
  const strip = useMemo(() => {
    const rng = new Rng(`${prep.seed}::visual`);
    const out: string[] = [];
    for (let i = 0; i < 22; i++) out.push(eligible[rng.int(eligible.length)]);
    out.push(...prep.candidates);
    out.push(eligible[rng.int(eligible.length)], eligible[rng.int(eligible.length)]);
    return out;
  }, [prep.prepId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase !== 'spin') return;
    const el = trackRef.current;
    if (!el) return;
    const item = 96 + 10;
    const target = 22 * item - (el.parentElement!.clientWidth / 2 - item);
    el.style.transition = 'none';
    el.style.transform = 'translateX(0)';
    void el.offsetWidth;
    el.style.transition = 'transform 2.4s cubic-bezier(.12,.72,.18,1)';
    el.style.transform = `translateX(${target}px)`;
    const t = window.setTimeout(() => {
      seenRoulette.add(prep.prepId);
      setPhase('done');
      sfx.confirm();
    }, 2500);
    return () => window.clearTimeout(t);
  }, [phase, prep.prepId]);

  async function pick(bossId: string) {
    if (busy) return;
    setBusy(true);
    try {
      seenRoulette.add(prep.prepId);
      await act((db) => chooseBoss(db, data.battle.rev, bossId));
      sfx.confirm();
    } catch (e) {
      toast(e instanceof OpError ? e.message : 'تعذر بدء المعركة', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page roulette-page">
      <section className="card pad">
        <h2>{phase === 'spin' ? 'اختيار المرشحَين…' : 'اختر زعيمًا للمواجهة'}</h2>
        <div className="team-mini">
          {prep.teamHeroIds.map((id) => (
            <img key={id} src={displayUrl(CATALOG.heroById.get(id)!.levelImages[0])} alt={CATALOG.heroById.get(id)!.name} />
          ))}
        </div>
      </section>
      {phase === 'spin' ? (
        <div className="roulette-window" aria-hidden="true">
          <div className="roulette-marker" />
          <div className="roulette-track" ref={trackRef}>
            {strip.map((id, i) => (
              <div className="roulette-item" key={i}>
                <img src={displayUrl(CATALOG.bossById.get(id)!.image)} alt="" />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="candidates">
          {prep.candidates.map((id) => {
            const b = CATALOG.bossById.get(id)!;
            return (
              <article key={id} className="candidate">
                <div className="portrait-frame">
                  <img src={displayUrl(b.image)} alt={b.name} />
                </div>
                <h3>{b.name}</h3>
                <p className="muted small">{b.title}</p>
                <p className="small">
                  الحياة <Num>{b.maxHp}</Num>
                </p>
                <button className="btn btn-primary" disabled={busy} onClick={() => void pick(id)} data-testid={`pick-${id}`}>
                  واجه {b.name}
                </button>
              </article>
            );
          })}
        </div>
      )}
      <div className="center">
        <button className="btn btn-ghost btn-small" disabled={busy || phase === 'spin'} onClick={() => void act((db) => cancelPrep(db, data.battle.rev))}>
          تغيير الفريق (تحضير جديد)
        </button>
      </div>
    </div>
  );
}

const OUTCOME_TEXT: Record<string, string> = { victory: 'انتصار!', defeat: 'خسارة', draw: 'تعادل', retreat: 'انسحاب' };

function Result({ data }: { data: AppData }) {
  const rec = data.battle;
  const s = rec.state!;
  const settled = rec.settled;
  const boss = CATALOG.bossById.get(s.bossId)!;
  const [busy, setBusy] = useState(false);
  const win = s.outcome === 'victory';
  return (
    <div className="page result-page">
      <section className={`card result-card out-${s.outcome}`}>
        <img className="result-boss" src={displayUrl(boss.image)} alt={boss.name} />
        <h2>{OUTCOME_TEXT[s.outcome ?? 'retreat']}</h2>
        <p>
          ضد {boss.name} · الجولات <Num>{s.round}</Num>
        </p>
        {win ? <p className="ok">كل بطل مشارك كسب +1 انتصار، حتى من سقط.</p> : <p className="muted">لا انتصارات في {s.outcome === 'draw' ? 'التعادل' : s.outcome === 'retreat' ? 'الانسحاب' : 'الخسارة'}. لا عقوبة.</p>}
        <div className="result-team">
          {s.teamHeroIds.map((id) => {
            const h = CATALOG.heroById.get(id)!;
            const w = data.heroes.find((x) => x.heroId === id)?.wins ?? 0;
            const up = settled?.levelUps.find((l) => l.heroId === id);
            return (
              <div key={id} className={`result-hero ${up ? 'leveled' : ''}`}>
                <img src={displayUrl(heroImageForLevel(h, cosmeticLevel(w)))} alt={h.name} />
                <strong>{h.name}</strong>
                <span className="small">
                  <Num>{w}</Num> انتصار{win ? ' (+1)' : ''}
                </span>
                {up ? (
                  <span className="chip gold">
                    مستوى <Num>{up.level}</Num>!
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
        <button
          className="btn btn-primary"
          disabled={busy}
          data-testid="new-battle"
          onClick={async () => {
            setBusy(true);
            try {
              await act((db) => finishBattle(db, rec.rev));
            } finally {
              setBusy(false);
            }
          }}
        >
          معركة جديدة: اختيار الفريق
        </button>
      </section>
    </div>
  );
}

export function BattlePage({ data, reducedMotion }: { data: AppData; reducedMotion: boolean }) {
  const rec = data.battle;
  const exec = rec.execution;
  const playbackDone = !exec || exec.cursor >= exec.events.length;
  if (rec.state && (!rec.state.outcome || !playbackDone)) {
    return <Arena key={rec.state.battleId} data={data} reducedMotion={reducedMotion} />;
  }
  if (rec.state?.outcome) return <Result data={data} />;
  if (rec.prep) return <Roulette data={data} reducedMotion={reducedMotion} />;
  return <TeamSelect data={data} />;
}
