import { useState } from 'react';
import { sfx } from '../../audio/sfx';
import { canComplete, DIFFICULTY_LABEL, rewardFor } from '../../engine/economy';
import { progressFromXp } from '../../engine/progression';
import { act } from '../../store/appStore';
import { completeChallenge, OpError, type AppData } from '../../store/ops';
import type { Challenge } from '../../store/types';
import { Bar, BlobImg, Coins, EmptyState, fmt, Gems, iso, Num, Xp } from '../components/common';
import { confirmDialog, toast } from '../components/dialogs';
import { Icon } from '../components/Icon';
import { openOverlay } from '../nav';

export function AccountCard({ data }: { data: AppData }) {
  const p = progressFromXp(data.profile.xp);
  return (
    <section className="card account-card" aria-label="تقدم الحساب">
      <div className="account-top">
        <div className="rank-badge" aria-label={`الرتبة ${p.rank}`}>
          <Icon name="star" size={18} />
          <Num>{p.rank}</Num>
        </div>
        <div className="account-names">
          <strong>{p.rankName}</strong>
          <span>
            {p.maxed ? (
              <>
                المستوى <Num>45</Num> مكتمل · دورات الإتقان <Num>{p.masteryCycles}</Num>
              </>
            ) : (
              <>
                المستوى <Num>{p.level}</Num>
              </>
            )}
          </span>
        </div>
        <div className="wallet">
          <Coins n={data.profile.coins} />
          <Gems n={data.profile.gems} />
        </div>
      </div>
      <Bar value={p.barXp} max={p.barCost} tone="xp" label="شريط المستوى" />
      <div className="account-bar-text">
        <span>{p.maxed ? 'شريط الإتقان' : `شريط المستوى ${p.level}`}</span>
        <Num>
          {fmt(p.barXp)} / {fmt(p.barCost)} XP
        </Num>
      </div>
    </section>
  );
}

function ChallengeCard({ ch, data, done, busy, onComplete }: { ch: Challenge; data: AppData; done: boolean; busy: boolean; onComplete: () => void }) {
  const r = rewardFor(ch.difficulty, ch.customXp, ch.customCoins);
  void data;
  return (
    <article className={`challenge ${done ? 'is-done' : ''}`}>
      <BlobImg id={ch.imageId} alt={ch.name} className="challenge-img" fallback="target" />
      <div className="challenge-body">
        <h3>{ch.name}</h3>
        {ch.description ? <p className="muted small">{ch.description}</p> : null}
        <div className="chips">
          <span className={`chip diff-${ch.difficulty}`}>{DIFFICULTY_LABEL[ch.difficulty]}</span>
          <span className="chip">
            <Icon name={ch.recurrence === 'daily' ? 'repeat' : 'flag'} size={14} />
            {ch.recurrence === 'daily' ? 'يومي' : 'مرة واحدة'}
          </span>
        </div>
        <div className="reward-line">
          <Xp n={r.xp} />
          <Coins n={r.coins} />
        </div>
      </div>
      <div className="challenge-action">
        {done ? (
          <span className="done-badge">
            <Icon name="check" size={18} /> مكتمل
          </span>
        ) : (
          <button className="btn btn-primary" disabled={busy} onClick={onComplete}>
            كمّلت
          </button>
        )}
      </div>
    </article>
  );
}

export function ChallengesPage({ data }: { data: AppData }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const active = data.challenges.filter((c) => !c.archived);
  const daily = active.filter((c) => c.recurrence === 'daily');
  const isDone = (c: Challenge) => !canComplete(c.id, c.recurrence, data.todayKey, data.completions);
  const onceActive = active.filter((c) => c.recurrence === 'once' && !isDone(c));
  const onceDone = data.completions
    .filter((c) => c.kind === 'once')
    .sort((a, b) => b.at - a.at);

  async function complete(ch: Challenge) {
    if (busy) return;
    const r = rewardFor(ch.difficulty, ch.customXp, ch.customCoins);
    setBusy(ch.id);
    try {
      const ok = await confirmDialog({
        title: 'واش متأكد بلي كملتي هاد التحدّي؟',
        body: (
          <div className="confirm-reward">
            <strong>{ch.name}</strong>
            <div className="reward-line big">
              <Xp n={r.xp} />
              <Coins n={r.coins} />
            </div>
          </div>
        ),
        confirmText: 'نعم، كمّلت',
        cancelText: 'لا، رجوع',
      });
      if (!ok) return;
      const res = await act((db) => completeChallenge(db, ch.id));
      sfx.coin();
      toast(`${iso(`+${fmt(res.xp)} XP`)} و ${iso(`+${fmt(res.coins)} Coins`)}${res.gems ? ` و ${iso(`+${res.gems}`)} جوهرة` : ''}`, 'success');
    } catch (e) {
      toast(e instanceof OpError ? e.message : 'تعذر حفظ الإكمال', 'error');
    } finally {
      setBusy(null);
    }
  }

  const addBtn = (
    <button className="btn btn-primary" onClick={() => openOverlay({ kind: 'settings', section: 'challenges', editId: 'new' })}>
      <Icon name="plus" size={18} /> أضف تحديًا
    </button>
  );

  return (
    <div className="page challenges-page">
      <AccountCard data={data} />
      {active.length === 0 && onceDone.length === 0 ? (
        <EmptyState icon="target" title="ما زال ما عندك حتى تحدي" text="زيد التحديات ديالك: الاسم، الصورة، الصعوبة والتكرار." action={addBtn} />
      ) : (
        <>
          <section className="section">
            <div className="section-head">
              <h2>تحديات يومية</h2>
              <span className="muted small">تتجدد عند 00:00</span>
            </div>
            {daily.length ? (
              <div className="list">
                {daily.map((c) => (
                  <ChallengeCard key={c.id} ch={c} data={data} done={isDone(c)} busy={busy === c.id} onComplete={() => void complete(c)} />
                ))}
              </div>
            ) : (
              <p className="muted">لا توجد تحديات يومية بعد.</p>
            )}
          </section>
          <section className="section">
            <div className="section-head">
              <h2>أهداف مرة واحدة</h2>
            </div>
            {onceActive.length ? (
              <div className="list">
                {onceActive.map((c) => (
                  <ChallengeCard key={c.id} ch={c} data={data} done={false} busy={busy === c.id} onComplete={() => void complete(c)} />
                ))}
              </div>
            ) : (
              <p className="muted">لا توجد أهداف نشطة.</p>
            )}
            {onceDone.length ? (
              <div className="done-list">
                <button className="link-btn" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}>
                  الأهداف المكتملة (<Num>{onceDone.length}</Num>)
                </button>
                {showDone ? (
                  <ul>
                    {onceDone.map((c) => (
                      <li key={c.key}>
                        <Icon name="check" size={16} /> {c.snapshot.name} · <Xp n={c.snapshot.xp} /> <Coins n={c.snapshot.coins} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </section>
          <div className="center">{addBtn}</div>
        </>
      )}
    </div>
  );
}
