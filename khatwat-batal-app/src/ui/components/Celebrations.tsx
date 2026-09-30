// احتفالات الترقيات: عرض فقط. الصرف تم مسبقًا داخل المعاملة، فإعادة التحميل لا تعيد الصرف.
import { useEffect, useRef } from 'react';
import { sfx } from '../../audio/sfx';
import { CATALOG, displayUrl, heroImageForLevel } from '../../catalog';
import { RANK_NAMES } from '../../engine/progression';
import { act } from '../../store/appStore';
import { dismissAllNotices, dismissNotice, type AppData } from '../../store/ops';
import { Num } from './common';
import { Icon } from './Icon';

export function Celebrations({ data }: { data: AppData }) {
  const n = data.notices[0];
  const played = useRef<string | null>(null);
  useEffect(() => {
    if (n && played.current !== n.id) {
      played.current = n.id;
      sfx.levelUp();
    }
  }, [n]);
  if (!n) return null;
  const d = n.data as Record<string, unknown>;
  let title = '';
  let body: React.ReactNode = null;
  let img: string | null = null;
  switch (n.kind) {
    case 'level':
      title = `أكملت شريط المستوى ${d.level}!`;
      body = (
        <p>
          <Icon name="gem" size={18} /> +<Num>{String(d.gems)}</Num> جوهرة للأبطال
        </p>
      );
      break;
    case 'rank':
      title = `أكملت رتبة «${RANK_NAMES[d.rank as number]}»!`;
      body = <p>استحقاق {String(d.bossSlots)} زعيم جديد محفوظ لك، ويُفتح عند إضافة محتواه.</p>;
      break;
    case 'mastery':
      title = `دورة إتقان ${d.cycle}`;
      body = (
        <p>
          +<Num>{String(d.gems)}</Num> جوهرة
        </p>
      );
      break;
    case 'boss-unlock': {
      const b = CATALOG.bossById.get(String(d.bossId));
      title = `فُتح الزعيم ${b?.name ?? ''}`;
      img = b ? displayUrl(b.image) : null;
      break;
    }
    case 'cosmetic': {
      const h = CATALOG.heroById.get(String(d.heroId));
      title = `${h?.name ?? ''} وصل للمستوى ${d.level}`;
      img = h ? displayUrl(heroImageForLevel(h, d.level as number)) : null;
      body = <p>صورة جديدة مكتسبة!</p>;
      break;
    }
    case 'hero': {
      const h = CATALOG.heroById.get(String(d.heroId));
      title = `${h?.name ?? ''} انضم لأبطالك`;
      img = h ? displayUrl(h.levelImages[0]) : null;
      break;
    }
  }
  const more = data.notices.length - 1;
  return (
    <div className="modal-backdrop celebrate" role="presentation">
      <div className="modal celebration" role="dialog" aria-modal="true" aria-label={title}>
        <div className="confetti" aria-hidden="true">
          {Array.from({ length: 14 }, (_, i) => (
            <i key={i} style={{ ['--i' as string]: i }} />
          ))}
        </div>
        <Icon name="star" size={40} />
        <h2>{title}</h2>
        {img ? <img className="celebrate-img" src={img} alt="" /> : null}
        {body}
        <button className="btn btn-primary" onClick={() => void act((db) => dismissNotice(db, n.id))}>
          {more > 0 ? `التالي (${more})` : 'رائع!'}
        </button>
        {more > 0 ? (
          <button className="btn btn-ghost btn-small" onClick={() => void act((db) => dismissAllNotices(db))}>
            إغلاق الكل
          </button>
        ) : null}
      </div>
    </div>
  );
}
