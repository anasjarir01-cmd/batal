import { useEffect, useState } from 'react';
import { configureSfx } from '../audio/sfx';
import { music, useMusic } from '../audio/music';
import { applyUpdate, usePwa } from '../pwa/register';
import { useApp, useBootError } from '../store/appStore';
import type { MusicPosition } from '../store/types';
import { BattlePage } from './battle/BattlePage';
import { CardZoom } from './battle/CardZoom';
import { Celebrations } from './components/Celebrations';
import { DialogHost } from './components/dialogs';
import { Icon } from './components/Icon';
import { closeOverlay, goto, openOverlay, useNav, type Page } from './nav';
import { ChallengesPage } from './pages/ChallengesPage';
import { BossDetails, CollectionPage, HeroDetails, HeroStore } from './pages/CollectionPage';
import { HistorySheet } from './pages/HistorySheet';
import { RewardsPage } from './pages/RewardsPage';
import { SettingsSheet } from './settings/SettingsSheet';

const TABS: Array<{ page: Page; label: string; icon: string }> = [
  { page: 'challenges', label: 'التحديات', icon: 'target' },
  { page: 'rewards', label: 'الجوائز', icon: 'gift' },
  { page: 'collection', label: 'المجموعة', icon: 'cards' },
  { page: 'battle', label: 'القتال', icon: 'swords' },
];

const PAGE_TITLE: Record<Page, string> = {
  challenges: 'التحديات',
  rewards: 'الجوائز',
  collection: 'المجموعة',
  battle: 'القتال',
};

function useReducedMotion(pref: 'system' | 'on' | 'off' | undefined): boolean {
  const [sys, setSys] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setSys(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  if (pref === 'on') return true;
  if (pref === 'off') return false;
  return sys;
}

function MusicButton() {
  const m = useMusic();
  if (!m.tracks.length) return null;
  if (m.needsTap)
    return (
      <button className="pill-btn pulse" onClick={() => void music.play()} aria-label="متابعة الموسيقى">
        <Icon name="play" size={18} /> متابعة
      </button>
    );
  return (
    <button className="icon-btn" onClick={() => music.toggle()} aria-label={m.playing ? 'إيقاف الموسيقى مؤقتًا' : 'تشغيل الموسيقى'} aria-pressed={m.playing}>
      <Icon name={m.playing ? 'pause' : 'music'} />
    </button>
  );
}

export function App() {
  const data = useApp();
  const bootError = useBootError();
  const nav = useNav();
  const pwa = usePwa();
  const reduced = useReducedMotion(data?.settings.reduceMotion);

  useEffect(() => {
    if (!data) return;
    configureSfx(data.settings.sfxVolume, data.settings.sfxMuted);
    music.init(data.tracks, data.settings.musicVolume, data.settings.musicLoop, (data.meta.musicPosition as MusicPosition) ?? null);
  }, [data]);

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = reduced ? 'true' : 'false';
  }, [reduced]);

  if (bootError)
    return (
      <div className="boot-error">
        <h1>خطوة بطل</h1>
        <p>تعذر فتح التخزين المحلي في هذا المتصفح. جرّب إغلاق الألسنة الأخرى ثم أعد الفتح، أو تحقق من أن التخزين غير معطل في الإعدادات.</p>
        <small>{bootError}</small>
      </div>
    );
  if (!data)
    return (
      <div className="boot-loading" aria-busy="true">
        <div className="spinner" />
        <p>خطوة بطل</p>
      </div>
    );

  const battleBusy = nav.page === 'battle' && !!data.battle.execution && data.battle.execution.cursor < data.battle.execution.events.length;
  const o = nav.overlay;

  return (
    <div className={`app page-${nav.page}`} data-page={nav.page}>
      <div className="bg-anim" aria-hidden="true">
        <span className="blob b1" />
        <span className="blob b2" />
        <span className="blob b3" />
        <span className="blob b4" />
      </div>
      <header className="topbar">
        <div className="brand">
          <img src="./icons/icon.svg" alt="" width={30} height={30} />
          <div>
            <strong>خطوة بطل</strong>
            <small>{PAGE_TITLE[nav.page]}</small>
          </div>
        </div>
        <div className="topbar-actions">
          <MusicButton />
          <button className="icon-btn" onClick={() => openOverlay({ kind: 'history' })} aria-label="السجل">
            <Icon name="clock" />
          </button>
          <button className="icon-btn" onClick={() => openOverlay({ kind: 'settings' })} aria-label="الإعدادات">
            <Icon name="gear" />
          </button>
        </div>
      </header>

      {pwa.updateReady && !battleBusy ? (
        <div className="update-banner" role="status">
          <span>نسخة جديدة من التطبيق جاهزة.</span>
          <button className="btn btn-small btn-primary" onClick={() => void applyUpdate()}>
            تحديث الآن
          </button>
        </div>
      ) : null}

      <main className="content" id="main">
        {nav.page === 'challenges' && <ChallengesPage data={data} />}
        {nav.page === 'rewards' && <RewardsPage data={data} />}
        {nav.page === 'collection' && <CollectionPage data={data} />}
        {nav.page === 'battle' && <BattlePage data={data} reducedMotion={reduced} />}
      </main>

      {nav.page !== 'battle' && data.battle.state && !data.battle.state.outcome ? (
        <button className="resume-battle" onClick={() => goto('battle')}>
          <Icon name="swords" size={18} /> متابعة المعركة
        </button>
      ) : null}

      <nav className="tabbar" aria-label="الصفحات الرئيسية">
        {TABS.map((t) => (
          <button key={t.page} className={`tab ${nav.page === t.page ? 'active' : ''}`} onClick={() => goto(t.page)} aria-current={nav.page === t.page ? 'page' : undefined}>
            <Icon name={t.icon} size={24} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {o?.kind === 'settings' && <SettingsSheet data={data} initial={o} onClose={closeOverlay} />}
      {o?.kind === 'history' && <HistorySheet initialFilter={o.filter} onClose={closeOverlay} />}
      {o?.kind === 'heroStore' && <HeroStore data={data} onClose={closeOverlay} />}
      {o?.kind === 'hero' && <HeroDetails data={data} heroId={o.heroId} onClose={closeOverlay} />}
      {o?.kind === 'boss' && <BossDetails data={data} bossId={o.bossId} onClose={closeOverlay} />}
      {o?.kind === 'card' && <CardZoom data={data} abilityId={o.abilityId} cardId={o.cardId} target={o.target} onClose={closeOverlay} />}
      <Celebrations data={data} />
      <DialogHost />
    </div>
  );
}
