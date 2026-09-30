// تكبير البطاقة: الصورة الأصلية PNG كاملة (contain) مع وصف حي للقدرة والهدف، دون تنفيذها.
import { CATALOG, originalUrl, ROLE_LABEL } from '../../catalog';
import { previewPlayerHit } from '../../engine/battle/engine';
import type { AppData } from '../../store/ops';
import { Num, Sheet } from '../components/common';
import { abilityTint, tintClass } from './roles';
import { heroShortName } from './Units';

export function CardZoom({ data, abilityId, cardId, target, onClose }: { data: AppData; abilityId: string; cardId?: string; target?: number; onClose: () => void }) {
  const a = CATALOG.abilities.get(abilityId);
  if (!a) return null;
  const owner = CATALOG.heroById.get(a.ownerId) ?? CATALOG.bossById.get(a.ownerId);
  const st = data.battle.state && !data.battle.state.outcome ? data.battle.state : undefined;
  const preview = st && cardId && st.cards[cardId] ? previewPlayerHit(st, cardId) : null;
  const bossAction = st?.bossPlan.find((b) => b.abilityId === abilityId && !b.hidden);
  return (
    <Sheet title={a.name} onClose={onClose} wide className="zoom-sheet">
      <div className="zoom">
        <img className={`zoom-img framed ${tintClass(abilityTint(a.id))}`} src={originalUrl(a.image)} alt={`${a.name} — البطاقة الأصلية`} />
        <div className="zoom-info">
          <p className="muted small">
            {owner?.name}
            {owner && owner.kind === 'hero' ? ` — ${ROLE_LABEL[owner.role]}` : ' — الزعيم'} · <bdi>{a.id}</bdi>
          </p>
          <p>
            <strong>الطاقة: </strong>
            {a.cost !== undefined ? (
              <>
                <Num>{a.cost}</Num> من <Num>7</Num>
              </>
            ) : (
              'لا كلفة؛ واحدة من الحركات الثلاث'
            )}
          </p>
          <p>
            <strong>الهدف: </strong>
            {a.targetText}
          </p>
          <p className="effect-text">
            <strong>الأثر: </strong>
            {a.displayText}
          </p>
          {a.note ? (
            <p className="muted">
              <strong>توضيح: </strong>
              {a.note}
            </p>
          ) : null}
          {st && cardId && target !== undefined ? (
            <p className="live">
              الهدف المختار: <strong>{heroShortName(st.heroes[target].heroId)}</strong>
            </p>
          ) : null}
          {preview ? (
            <div className="live">
              <strong>المعاينة الآن (قبل الدفاع): </strong>
              <bdi className="num">
                {preview.base}
                {preview.bonus ? ` +${preview.bonus} (احتراق)` : ''}
                {preview.focus ? ` +${preview.focus} (تركيز)` : ''}
                {preview.mark ? ` +${preview.mark} (علامة)` : ''}
                {preview.expose ? ` +${preview.expose} (كشف)` : ''}
                {preview.weaken ? ` −${preview.weaken} (إضعاف)` : ''} = {preview.raw}
              </bdi>
              {preview.piercing ? <p className="small">ثاقب: يتجاوز الصدّ ويتركه.</p> : preview.shield ? <p className="small">صدّ الزعيم الحالي {preview.shield}{preview.reflect ? ` مع انعكاس ${preview.reflect}` : ''}.</p> : null}
              <p className="muted small">معاينة من الحالة الحالية؛ النتيجة الفعلية تُحسب عند التنفيذ مع حركة الزعيم المتزامنة.</p>
            </div>
          ) : null}
          {bossAction ? (
            <p className="live">
              أهداف هذه الجولة:{' '}
              {bossAction.targets.length ? bossAction.targets.map((t) => heroShortName(st!.heroes[t].heroId)).join('، ') : 'الزعيم نفسه'}
            </p>
          ) : null}
          <p className="muted small">المؤثر: {a.vfxText}</p>
        </div>
      </div>
    </Sheet>
  );
}
