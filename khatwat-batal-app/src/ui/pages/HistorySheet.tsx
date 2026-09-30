import { useEffect, useState } from 'react';
import { CATALOG } from '../../catalog';
import { formatDateTime } from '../../engine/dates';
import { DIFFICULTY_LABEL, type Difficulty } from '../../engine/economy';
import { getDb } from '../../store/appStore';
import { listLedger } from '../../store/ops';
import type { LedgerEntry } from '../../store/types';
import { fmt, Num, Sheet } from '../components/common';

const FILTERS: Array<{ id: string; label: string; types?: string[] }> = [
  { id: 'all', label: 'الكل' },
  { id: 'challenges', label: 'التحديات', types: ['challenge-complete'] },
  { id: 'rewards', label: 'المكافآت', types: ['level-up', 'mastery', 'challenge-complete'] },
  { id: 'purchases', label: 'المشتريات', types: ['reward-purchase', 'hero-purchase'] },
  { id: 'upgrades', label: 'الترقيات', types: ['level-up', 'rank-complete', 'mastery', 'cosmetic-level'] },
  { id: 'unlocks', label: 'فتح الشخصيات', types: ['boss-unlock', 'boss-entitlement', 'hero-purchase'] },
  { id: 'battles', label: 'المعارك', types: ['battle-result'] },
];

const OUTCOME: Record<string, string> = { victory: 'فوز', defeat: 'خسارة', draw: 'تعادل', retreat: 'انسحاب' };
const heroName = (id: unknown) => CATALOG.heroById.get(String(id))?.name ?? String(id);
const bossName = (id: unknown) => CATALOG.bossById.get(String(id))?.name ?? String(id);

function describe(e: LedgerEntry): { title: string; detail?: string } {
  const d = e.data as Record<string, unknown>;
  switch (e.type) {
    case 'challenge-complete':
      return { title: `إكمال: ${d.name}`, detail: `${DIFFICULTY_LABEL[d.difficulty as Difficulty] ?? ''} · +${fmt(d.xp as number)} XP · +${fmt(d.coins as number)} Coins` };
    case 'level-up':
      return { title: `إكمال شريط المستوى ${d.level}`, detail: `+${d.gems} جوهرة` };
    case 'mastery':
      return { title: `دورة إتقان ${d.cycle}`, detail: `+${d.gems} جوهرة` };
    case 'rank-complete':
      return { title: `إكمال الرتبة ${d.rank}`, detail: `استحقاق ${d.bossSlots} زعيم جديد` };
    case 'boss-entitlement':
      return { title: `استحقاق زعيم محفوظ (رتبة ${d.rank})`, detail: 'يُفتح تلقائيًا عند إضافة محتواه' };
    case 'boss-unlock':
      return { title: `فتح الزعيم ${bossName(d.bossId)}` };
    case 'reward-purchase':
      return { title: `شراء جائزة: ${d.name}`, detail: `−${fmt(d.price as number)} Coins` };
    case 'hero-purchase':
      return { title: `شراء البطل ${heroName(d.heroId)}`, detail: `−${d.price} جوهرة` };
    case 'battle-result':
      return {
        title: `معركة ضد ${bossName(d.bossId)}: ${OUTCOME[String(d.outcome)] ?? d.outcome}`,
        detail: `الجولات ${d.rounds}${(d.winners as string[])?.length ? ' · +1 انتصار لكل بطل مشارك' : ''}`,
      };
    case 'cosmetic-level':
      return { title: `${heroName(d.heroId)} وصل للمستوى التجميلي ${d.level}`, detail: `${d.wins} انتصار` };
    case 'backup-restore':
      return { title: 'استرجاع نسخة احتياطية' };
    default:
      return { title: e.type };
  }
}

export function HistorySheet({ initialFilter, onClose }: { initialFilter?: string; onClose: () => void }) {
  const [filter, setFilter] = useState(initialFilter ?? 'all');
  const [items, setItems] = useState<LedgerEntry[]>([]);
  const [more, setMore] = useState(false);
  const types = FILTERS.find((f) => f.id === filter)?.types;

  useEffect(() => {
    let live = true;
    void listLedger(getDb(), { types, limit: 40 }).then((r) => {
      if (!live) return;
      setItems(r);
      setMore(r.length === 40);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function loadMore() {
    const last = items[items.length - 1];
    if (!last) return;
    const r = await listLedger(getDb(), { types, limit: 40, before: last.at });
    setItems((x) => [...x, ...r]);
    setMore(r.length === 40);
  }

  return (
    <Sheet title="السجل" onClose={onClose}>
      <div className="filter-chips" role="tablist">
        {FILTERS.map((f) => (
          <button key={f.id} role="tab" aria-selected={filter === f.id} className={`chip-btn ${filter === f.id ? 'on' : ''}`} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {items.length === 0 ? (
        <p className="muted center pad">لا توجد عمليات بعد.</p>
      ) : (
        <ul className="history-list">
          {items.map((e) => {
            const d = describe(e);
            return (
              <li key={e.id} className={`h-${e.type}`}>
                <strong>{d.title}</strong>
                {d.detail ? <span className="small">{d.detail}</span> : null}
                <time className="muted small">
                  <Num>{formatDateTime(e.at)}</Num>
                </time>
              </li>
            );
          })}
        </ul>
      )}
      {more ? (
        <div className="center pad">
          <button className="btn btn-ghost" onClick={() => void loadMore()}>
            المزيد
          </button>
        </div>
      ) : null}
    </Sheet>
  );
}
