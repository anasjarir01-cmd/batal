// قائمة المعركة من زر الترس أعلى يسار البانر. فتحها لا ينفذ شيئًا وإغلاقها لا يمس الخطة.
// الأوامر ذات الأثر (تمرير الجولة، الانسحاب) تطلب تأكيدًا وتستعمل نفس عمليات المحرك.
import { useEffect, useRef } from 'react';
import { music, useMusic } from '../../audio/music';
import { configureSfx } from '../../audio/sfx';
import { CATALOG, displayUrl } from '../../catalog';
import { applyUpdate, usePwa } from '../../pwa/register';
import { act } from '../../store/appStore';
import { saveSettings, type AppData } from '../../store/ops';
import { Num } from '../components/common';
import { Icon } from '../components/Icon';
import { openOverlay } from '../nav';

export interface CycleEntry {
  round: number;
  slot: number;
  abilityId: string;
}

export function ArenaMenu({
  data,
  reducedMotion,
  playing,
  locked,
  cycle,
  onClose,
  onPass,
  onRetreat,
  onSkip,
  onLeave,
}: {
  data: AppData;
  reducedMotion: boolean;
  playing: boolean;
  locked: boolean;
  cycle: CycleEntry[];
  onClose: () => void;
  onPass: () => void;
  onRetreat: () => void;
  onSkip: () => void;
  onLeave: () => void;
}) {
  const m = useMusic();
  const pwa = usePwa();
  const s = data.settings;
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    panel.current?.querySelector<HTMLElement>('button')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const setSfxMuted = (muted: boolean) => {
    configureSfx(s.sfxVolume, muted);
    void act((db) => saveSettings(db, { sfxMuted: muted }));
  };

  return (
    <div className="amenu-backdrop" role="presentation" onClick={onClose}>
      <div className="amenu" ref={panel} role="dialog" aria-modal="true" aria-label="قائمة المعركة" onClick={(e) => e.stopPropagation()}>
        <header className="amenu-head">
          <strong>قائمة المعركة</strong>
          <button className="amenu-close" onClick={onClose} aria-label="إغلاق القائمة">
            <Icon name="close" size={18} />
          </button>
        </header>
        <p className="amenu-note">فتح القائمة لا ينفذ شيئًا، وخطتك الحالية تبقى كما هي.</p>

        {playing ? (
          <button className="amenu-item" onClick={onSkip}>
            <Icon name="skip" size={18} />
            <span>
              تخطي العرض
              <small>تظهر النتيجة المحفوظة مباشرة</small>
            </span>
          </button>
        ) : null}

        <button className="amenu-item" onClick={onPass} disabled={locked}>
          <Icon name="next" size={18} />
          <span>
            تمرير الجولة
            <small>دون لعب أي بطاقة؛ الزعيم ينفذ حركاته الثلاث</small>
          </span>
        </button>

        <div className="amenu-group" role="group" aria-label="الصوت والحركة">
          <button className="amenu-toggle" aria-pressed={!s.sfxMuted} onClick={() => setSfxMuted(!s.sfxMuted)}>
            <Icon name={s.sfxMuted ? 'mute' : 'volume'} size={18} />
            <span>المؤثرات الصوتية</span>
            <i className="sw" aria-hidden="true" />
          </button>
          {m.tracks.length ? (
            <button className="amenu-toggle" aria-pressed={m.playing} onClick={() => (m.needsTap ? void music.play() : music.toggle())}>
              <Icon name={m.playing ? 'pause' : 'music'} size={18} />
              <span>الموسيقى</span>
              <i className="sw" aria-hidden="true" />
            </button>
          ) : null}
          <button className="amenu-toggle" aria-pressed={reducedMotion} onClick={() => void act((db) => saveSettings(db, { reduceMotion: reducedMotion ? 'off' : 'on' }))}>
            <Icon name="motion" size={18} />
            <span>تقليل الحركة</span>
            <i className="sw" aria-hidden="true" />
          </button>
          <div className="amenu-speed" role="radiogroup" aria-label="سرعة عرض التنفيذ">
            <span>سرعة العرض</span>
            {([1, 2] as const).map((v) => (
              <button key={v} role="radio" aria-checked={s.battleSpeed === v} onClick={() => void act((db) => saveSettings(db, { battleSpeed: v }))}>
                <Num>×{v}</Num>
              </button>
            ))}
          </div>
        </div>

        <section className="amenu-cycle" aria-label="حركات الزعيم المنفذة في هذه الدورة">
          <span>
            حركات الزعيم المنفذة في هذه الدورة{' '}
            <Num>
              {cycle.length}/9
            </Num>
          </span>
          <div className="amenu-thumbs">
            {cycle.length ? (
              cycle.map((h) => {
                const a = CATALOG.abilities.get(h.abilityId)!;
                return (
                  <button key={`${h.round}-${h.slot}`} className="log-thumb" onClick={() => openOverlay({ kind: 'card', abilityId: a.id })} aria-label={a.name}>
                    <img src={displayUrl(a.image)} alt={a.name} />
                  </button>
                );
              })
            ) : (
              <small className="muted">لا شيء بعد.</small>
            )}
          </div>
        </section>

        {pwa.updateReady && !playing ? (
          <button className="amenu-item update" onClick={() => void applyUpdate()}>
            <Icon name="download" size={18} />
            <span>
              تحديث التطبيق الآن
              <small>نسخة جديدة جاهزة؛ المعركة والبيانات تبقى محفوظة</small>
            </span>
          </button>
        ) : null}

        <button className="amenu-item" onClick={onLeave}>
          <Icon name="exit" size={18} />
          <span>
            العودة إلى صفحات التطبيق
            <small>المعركة تبقى محفوظة وتتابعها من «متابعة المعركة»</small>
          </span>
        </button>

        <button className="amenu-item danger" onClick={onRetreat} disabled={locked}>
          <Icon name="retreat" size={18} />
          <span>
            الانسحاب من المعركة
            <small>تنتهي المعركة دون انتصارات، بلا عقوبة</small>
          </span>
        </button>
      </div>
    </div>
  );
}
