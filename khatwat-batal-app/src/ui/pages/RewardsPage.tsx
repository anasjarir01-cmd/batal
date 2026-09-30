import { useState } from 'react';
import { sfx } from '../../audio/sfx';
import { act } from '../../store/appStore';
import { OpError, purchaseReward, uid, type AppData } from '../../store/ops';
import type { Reward } from '../../store/types';
import { BlobImg, Coins, EmptyState, fmt, Num } from '../components/common';
import { confirmDialog, toast } from '../components/dialogs';
import { Icon } from '../components/Icon';
import { openOverlay } from '../nav';

export function RewardsPage({ data }: { data: AppData }) {
  const [busy, setBusy] = useState<string | null>(null);
  const visible = data.rewards.filter((r) => !r.archived && !(r.recurrence === 'once' && data.purchasedOnce.includes(r.id)));

  async function buy(r: Reward) {
    if (busy) return;
    setBusy(r.id);
    // رمز فريد لهذا التأكيد: نفس التأكيد لا يُصرف مرتين، والشراء المتكرر يحتاج تأكيدًا جديدًا
    const token = uid('buy-');
    try {
      const missing = r.price - data.profile.coins;
      if (missing > 0) {
        await confirmDialog({
          title: 'الرصيد غير كافٍ',
          body: (
            <p>
              ثمن «{r.name}» <Coins n={r.price} />، ورصيدك <Coins n={data.profile.coins} />. ينقصك <strong><Num>{fmt(missing)}</Num></strong> Coins.
            </p>
          ),
          confirmText: 'حسنًا',
          cancelText: 'إغلاق',
        });
        return;
      }
      const ok = await confirmDialog({
        title: 'تأكيد الشراء',
        body: (
          <div className="confirm-reward">
            <strong>{r.name}</strong>
            <div className="reward-line big">
              <Coins n={r.price} />
            </div>
            <p className="muted small">الرصيد بعد الشراء: <Num>{fmt(data.profile.coins - r.price)}</Num> Coins</p>
          </div>
        ),
        confirmText: 'اشترِ',
      });
      if (!ok) return;
      await act((db) => purchaseReward(db, r.id, token));
      sfx.coin();
      toast(`تم شراء «${r.name}». استمتع بجائزتك!`, 'success');
    } catch (e) {
      toast(e instanceof OpError ? e.message : 'تعذر إتمام الشراء', 'error');
    } finally {
      setBusy(null);
    }
  }

  const addBtn = (
    <button className="btn btn-primary" onClick={() => openOverlay({ kind: 'settings', section: 'rewards', editId: 'new' })}>
      <Icon name="plus" size={18} /> أضف جائزة
    </button>
  );

  return (
    <div className="page rewards-page">
      <section className="card balance-card">
        <div>
          <span className="muted">رصيدك</span>
          <div className="balance-big">
            <Coins n={data.profile.coins} />
          </div>
        </div>
        <button className="btn btn-ghost btn-small" onClick={() => openOverlay({ kind: 'history', filter: 'purchases' })}>
          <Icon name="clock" size={16} /> المشتريات
        </button>
      </section>
      {visible.length === 0 ? (
        <EmptyState icon="gift" title="متجر الجوائز فارغ" text="أضف جوائزك الشخصية وحدد ثمنها بالـCoins." action={addBtn} />
      ) : (
        <>
          <div className="reward-grid">
            {visible.map((r) => (
              <article key={r.id} className="reward-card">
                <BlobImg id={r.imageId} alt={r.name} className="reward-img" fallback="gift" />
                <div className="reward-body">
                  <h3>{r.name}</h3>
                  {r.description ? <p className="muted small">{r.description}</p> : null}
                  <div className="chips">
                    <span className="chip">{r.recurrence === 'once' ? 'مرة واحدة' : 'متكررة'}</span>
                  </div>
                  <div className="reward-buy">
                    <Coins n={r.price} />
                    <button className="btn btn-primary btn-small" disabled={busy === r.id} onClick={() => void buy(r)}>
                      شراء
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <div className="center">{addBtn}</div>
        </>
      )}
    </div>
  );
}
