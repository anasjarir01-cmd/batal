import { useState } from 'react';
import { sfx } from '../../audio/sfx';
import { CATALOG, displayUrl, heroImageForLevel, originalUrl, rankCompletionRewards, ROLE_LABEL } from '../../catalog';
import { cosmeticLevel, nextCosmeticThreshold } from '../../engine/economy';
import { act } from '../../store/appStore';
import { buyHero, OpError, type AppData } from '../../store/ops';
import { Bar, EmptyState, fmt, Gems, Num, Sheet } from '../components/common';
import { confirmDialog, toast } from '../components/dialogs';
import { Icon } from '../components/Icon';
import { openOverlay } from '../nav';

function unlockCondition(bossId: string): string {
  for (const [rank, slots] of Object.entries(rankCompletionRewards)) {
    if (slots.includes(bossId)) return `يُفتح عند إكمال الرتبة ${rank}`;
  }
  return 'شرط الفتح لم يُحدد بعد';
}

export function CollectionPage({ data }: { data: AppData }) {
  const [tab, setTab] = useState<'heroes' | 'bosses'>('heroes');
  const owned = data.heroes.filter((h) => CATALOG.heroById.has(h.heroId));
  const unlocked = new Set(data.bosses.map((b) => b.bossId));
  return (
    <div className="page collection-page">
      <div className="big-toggle" role="tablist">
        <button role="tab" aria-selected={tab === 'heroes'} className={tab === 'heroes' ? 'on' : ''} onClick={() => setTab('heroes')}>
          <Icon name="shield" size={28} />
          الأبطال
          <small>
            <Num>{owned.length}</Num>
          </small>
        </button>
        <button role="tab" aria-selected={tab === 'bosses'} className={tab === 'bosses' ? 'on' : ''} onClick={() => setTab('bosses')}>
          <Icon name="swords" size={28} />
          الـBosses
          <small>
            <Num>{CATALOG.bosses.length}</Num>
          </small>
        </button>
      </div>

      {tab === 'heroes' ? (
        <>
          <div className="store-row">
            <Gems n={data.profile.gems} />
            <button className="btn btn-primary btn-small" onClick={() => openOverlay({ kind: 'heroStore' })}>
              <Icon name="gem" size={16} /> متجر الأبطال
            </button>
          </div>
          <div className="hero-grid">
            {owned.map((o) => {
              const h = CATALOG.heroById.get(o.heroId)!;
              const lvl = cosmeticLevel(o.wins);
              const next = nextCosmeticThreshold(o.wins);
              return (
                <button key={o.heroId} className={`hero-card lvl-${lvl}`} onClick={() => openOverlay({ kind: 'hero', heroId: o.heroId })}>
                  <div className="portrait-frame">
                    <img src={displayUrl(heroImageForLevel(h, lvl))} alt={h.name} loading="lazy" draggable={false} />
                  </div>
                  <div className="hero-card-info">
                    <strong>{h.name}</strong>
                    <span className="muted small">{ROLE_LABEL[h.role]}</span>
                    <span className="small">
                      المستوى <Num>{lvl}</Num> · <Num>{fmt(o.wins)}</Num> انتصار
                    </span>
                    {next !== null ? <Bar value={o.wins} max={next} tone="wins" label="التقدم للمستوى التالي" /> : <span className="chip gold">أقصى مستوى</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <div className="boss-grid">
          {CATALOG.bosses.map((b) => {
            const open = unlocked.has(b.id);
            return (
              <button key={b.id} className={`boss-card ${open ? '' : 'locked'}`} onClick={() => openOverlay({ kind: 'boss', bossId: b.id })} aria-label={open ? b.name : `زعيم مقفل: ${unlockCondition(b.id)}`}>
                <div className="portrait-frame">
                  <img src={displayUrl(b.image)} alt={open ? b.name : ''} loading="lazy" draggable={false} />
                  {!open ? (
                    <div className="lock-layer">
                      <Icon name="lock" size={40} />
                    </div>
                  ) : null}
                </div>
                <div className="hero-card-info">
                  <strong>{open ? b.name : 'زعيم مقفل'}</strong>
                  <span className="muted small">{open ? b.title : unlockCondition(b.id)}</span>
                  {open ? (
                    <span className="small">
                      الحياة <Num>{b.maxHp}</Num>
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function HeroDetails({ data, heroId, onClose }: { data: AppData; heroId: string; onClose: () => void }) {
  const h = CATALOG.heroById.get(heroId);
  const o = data.heroes.find((x) => x.heroId === heroId);
  const [big, setBig] = useState<string | null>(null);
  if (!h || !o) return null;
  const lvl = cosmeticLevel(o.wins);
  const next = nextCosmeticThreshold(o.wins);
  return (
    <Sheet title={`${h.name} — ${h.title}`} onClose={onClose} wide>
      <div className="details">
        <div className="details-hero">
          <button className="portrait-frame tall" onClick={() => setBig(heroImageForLevel(h, lvl))} aria-label="عرض الصورة بالحجم الأصلي">
            <img src={displayUrl(heroImageForLevel(h, lvl))} alt={h.name} draggable={false} />
          </button>
          <div className="stats">
            <div className="chips">
              <span className="chip">{ROLE_LABEL[h.role]}</span>
              <span className="chip">
                الحياة القصوى <Num>{h.maxHp}</Num>
              </span>
              <span className="chip gold">
                المستوى التجميلي <Num>{lvl}</Num>
              </span>
            </div>
            <p className="small">
              <Num>{fmt(o.wins)}</Num> انتصار{next !== null ? <> · المستوى التالي عند <Num>{next}</Num></> : null}
            </p>
            <p className="muted small">{h.flavor}</p>
          </div>
        </div>
        <h3>القدرات</h3>
        <div className="ability-strip">
          {h.abilityIds.map((id) => {
            const a = CATALOG.abilities.get(id)!;
            return (
              <button key={id} className="card-thumb" onClick={() => openOverlay({ kind: 'card', abilityId: id })} aria-label={`${a.name} — عرض البطاقة`}>
                <img src={displayUrl(a.image)} alt={a.name} loading="lazy" draggable={false} />
              </button>
            );
          })}
        </div>
        <h3>الصور المكتسبة</h3>
        <div className="level-gallery">
          {h.levelImages.slice(0, lvl).map((img, i) => (
            <button key={img} className="portrait-frame small-frame" onClick={() => setBig(img)} aria-label={`صورة المستوى ${i + 1}`}>
              <img src={displayUrl(img)} alt={`${h.name} — المستوى ${i + 1}`} loading="lazy" draggable={false} />
              <span className="lvl-tag">
                <Num>{i + 1}</Num>
              </span>
            </button>
          ))}
        </div>
        <h3>القصة</h3>
        <div className="story">
          {h.story.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </div>
      {big ? (
        <div className="lightbox" role="dialog" aria-label="الصورة الأصلية" onClick={() => setBig(null)}>
          <img src={originalUrl(big)} alt={h.name} />
        </div>
      ) : null}
    </Sheet>
  );
}

export function BossDetails({ data, bossId, onClose }: { data: AppData; bossId: string; onClose: () => void }) {
  const b = CATALOG.bossById.get(bossId);
  if (!b) return null;
  const open = data.bosses.some((x) => x.bossId === bossId);
  if (!open)
    return (
      <Sheet title="زعيم مقفل" onClose={onClose}>
        <div className="locked-info">
          <Icon name="lock" size={48} />
          <p>{unlockCondition(bossId)}</p>
          <p className="muted small">القصة والقدرات تظهر بعد الفتح.</p>
        </div>
      </Sheet>
    );
  return (
    <Sheet title={`${b.name} — ${b.title}`} onClose={onClose} wide>
      <div className="details">
        <div className="details-hero">
          <div className="portrait-frame tall">
            <img src={displayUrl(b.image)} alt={b.name} draggable={false} />
          </div>
          <div className="stats">
            <div className="chips">
              <span className="chip">
                الحياة القصوى <Num>{b.maxHp}</Num>
              </span>
              <span className="chip">
                المرحلة الثانية عند <Num>{b.maxHp / 2}</Num> أو أقل
              </span>
            </div>
            <p className="small">{b.combatStyle}</p>
            <p className="muted small">
              <strong>المرحلة الثانية: </strong>
              {b.phase2Text}
            </p>
          </div>
        </div>
        <h3>الحركات التسع</h3>
        <div className="ability-strip nine">
          {b.abilityIds.map((id) => {
            const a = CATALOG.abilities.get(id)!;
            return (
              <button key={id} className="card-thumb" onClick={() => openOverlay({ kind: 'card', abilityId: id })} aria-label={`${a.name} — عرض البطاقة`}>
                <img src={displayUrl(a.image)} alt={a.name} loading="lazy" draggable={false} />
              </button>
            );
          })}
        </div>
        <h3>القصة</h3>
        <div className="story">
          {b.story.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

export function HeroStore({ data, onClose }: { data: AppData; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const owned = new Set(data.heroes.map((h) => h.heroId));
  const forSale = CATALOG.heroes.filter((h) => !owned.has(h.id));
  async function buy(heroId: string) {
    const h = CATALOG.heroById.get(heroId)!;
    if (busy) return;
    setBusy(true);
    try {
      if (data.profile.gems < h.gemPrice) {
        toast(`ينقصك ${h.gemPrice - data.profile.gems} جوهرة`, 'error');
        return;
      }
      const ok = await confirmDialog({ title: `شراء ${h.name}؟`, body: <p>الثمن <Gems n={h.gemPrice} /></p>, confirmText: 'اشترِ' });
      if (!ok) return;
      await act((db) => buyHero(db, heroId));
      sfx.levelUp();
      toast(`${h.name} انضم إلى أبطالك!`, 'success');
    } catch (e) {
      toast(e instanceof OpError ? e.message : 'تعذر الشراء', 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title="متجر الأبطال" onClose={onClose}>
      <div className="store-row">
        <span>رصيدك</span>
        <Gems n={data.profile.gems} />
      </div>
      {forSale.length === 0 ? (
        <EmptyState icon="gem" title="لا يوجد أبطال جدد حاليًا" text="كل الأبطال المتاحين في مجموعتك. جواهرك تتراكم إلى أن يُضاف أبطال جدد." />
      ) : (
        <div className="hero-grid">
          {forSale.map((h) => (
            <div key={h.id} className="hero-card">
              <div className="portrait-frame">
                <img src={displayUrl(h.levelImages[0])} alt={h.name} draggable={false} />
              </div>
              <div className="hero-card-info">
                <strong>{h.name}</strong>
                <span className="muted small">{ROLE_LABEL[h.role]}</span>
                <Gems n={h.gemPrice} />
                <button className="btn btn-primary btn-small" disabled={busy} onClick={() => void buy(h.id)}>
                  شراء
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}
