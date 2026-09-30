import { useEffect, useRef, useState } from 'react';
import { music, probeAudio, useMusic } from '../../audio/music';
import { sfx } from '../../audio/sfx';
import { CATALOG } from '../../catalog';
import { DIFFICULTIES, DIFFICULTY_LABEL, rewardFor, type Difficulty } from '../../engine/economy';
import { assetStatus, downloadAssets, type AssetStatus, type DownloadProgress } from '../../pwa/assetCache';
import { exportBackup, importBackup, parseBackup } from '../../store/backup';
import { act, getDb, refresh } from '../../store/appStore';
import { requestPersistentStorage, storageEstimate } from '../../store/db';
import {
  addTrack,
  archiveChallenge,
  archiveReward,
  OpError,
  putBlob,
  removeTrack,
  reorderTracks,
  saveChallenge,
  saveReward,
  saveSettings,
  setMeta,
  type AppData,
} from '../../store/ops';
import type { Challenge, Reward, Settings } from '../../store/types';
import { BlobImg, Coins, fmt, Num, readFile, Sheet, Xp } from '../components/common';
import { confirmDialog, toast } from '../components/dialogs';
import { Icon } from '../components/Icon';
import type { Overlay } from '../nav';

type Section = 'challenges' | 'rewards' | 'music' | 'sound' | 'look' | 'data';
const SECTIONS: Array<{ id: Section; label: string; icon: string }> = [
  { id: 'challenges', label: 'التحديات', icon: 'target' },
  { id: 'rewards', label: 'الجوائز', icon: 'gift' },
  { id: 'music', label: 'الموسيقى', icon: 'music' },
  { id: 'sound', label: 'الصوت', icon: 'volume' },
  { id: 'look', label: 'المظهر', icon: 'star' },
  { id: 'data', label: 'البيانات', icon: 'download' },
];

function errMsg(e: unknown, fallback: string) {
  return e instanceof OpError ? e.message : fallback;
}

function ImagePicker({ value, onChange, purpose }: { value: string | null; onChange: (id: string | null) => void; purpose: 'challenge' | 'reward' }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="image-picker">
      <BlobImg id={value} alt="الصورة المختارة" className="picker-preview" fallback="image" />
      <div className="picker-actions">
        <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => ref.current?.click()}>
          <Icon name="image" size={16} /> {value ? 'تغيير الصورة' : 'اختر صورة'}
        </button>
        {value ? (
          <button type="button" className="btn btn-ghost btn-small" onClick={() => onChange(null)}>
            إزالة
          </button>
        ) : null}
      </div>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        hidden
        data-testid={`${purpose}-image-input`}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setBusy(true);
          try {
            const rec = await putBlob(getDb(), await readFile(f), purpose);
            onChange(rec.id);
          } catch (err) {
            toast(errMsg(err, 'تعذر حفظ الصورة'), 'error');
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

function ChallengeEditor({ initial, onDone }: { initial?: Challenge; onDone: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [imageId, setImageId] = useState<string | null>(initial?.imageId ?? null);
  const [difficulty, setDifficulty] = useState<Difficulty>(initial?.difficulty ?? 'easy');
  const [xp, setXp] = useState(String(initial?.customXp ?? ''));
  const [coins, setCoins] = useState(String(initial?.customCoins ?? ''));
  const [recurrence, setRecurrence] = useState(initial?.recurrence ?? 'daily');
  const [busy, setBusy] = useState(false);
  const toInt = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN);
  const preview = difficulty === 'open' ? { xp: toInt(xp), coins: toInt(coins) } : rewardFor(difficulty);

  async function save() {
    setBusy(true);
    try {
      await act((db) =>
        saveChallenge(db, {
          id: initial?.id,
          name,
          description,
          imageId,
          difficulty,
          customXp: difficulty === 'open' ? toInt(xp) : undefined,
          customCoins: difficulty === 'open' ? toInt(coins) : undefined,
          recurrence,
        }),
      );
      toast(initial ? 'تم حفظ التعديل' : 'تمت إضافة التحدي', 'success');
      onDone();
    } catch (e) {
      toast(errMsg(e, 'تعذر الحفظ'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="editor"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label>
        الاسم
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required placeholder="مثال: قراءة 10 صفحات" />
      </label>
      <ImagePicker value={imageId} onChange={setImageId} purpose="challenge" />
      <label>
        وصف (اختياري)
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={500} />
      </label>
      <label>
        الصعوبة
        <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
          {DIFFICULTIES.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
              {d.xp !== null ? ` — ${d.xp} XP / ${d.coins} Coins` : ' — تحدد القيم يدويًا'}
            </option>
          ))}
        </select>
      </label>
      {difficulty === 'open' ? (
        <div className="row2">
          <label>
            XP
            <input inputMode="numeric" pattern="\d*" value={xp} onChange={(e) => setXp(e.target.value)} required />
          </label>
          <label>
            Coins
            <input inputMode="numeric" pattern="\d*" value={coins} onChange={(e) => setCoins(e.target.value)} required />
          </label>
        </div>
      ) : null}
      <fieldset className="radio-row">
        <legend>التكرار</legend>
        <label>
          <input type="radio" checked={recurrence === 'daily'} onChange={() => setRecurrence('daily')} /> يومي
        </label>
        <label>
          <input type="radio" checked={recurrence === 'once'} onChange={() => setRecurrence('once')} /> مرة واحدة
        </label>
      </fieldset>
      <p className="muted small">
        المكافأة:{' '}
        {Number.isFinite(preview.xp) && Number.isFinite(preview.coins) ? (
          <>
            <Xp n={preview.xp} /> <Coins n={preview.coins} />
          </>
        ) : (
          'أدخل أعدادًا صحيحة غير سالبة'
        )}
        {initial ? ' · التعديل يطبق اليوم إذا لم تُصرف مكافأة هذا الاستحقاق بعد.' : null}
      </p>
      <div className="editor-actions">
        <button className="btn btn-primary" type="submit" disabled={busy}>
          حفظ
        </button>
        <button className="btn btn-ghost" type="button" onClick={onDone}>
          رجوع
        </button>
      </div>
    </form>
  );
}

function RewardEditor({ initial, onDone }: { initial?: Reward; onDone: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [imageId, setImageId] = useState<string | null>(initial?.imageId ?? null);
  const [price, setPrice] = useState(String(initial?.price ?? ''));
  const [recurrence, setRecurrence] = useState<Reward['recurrence']>(initial?.recurrence ?? 'repeat');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const p = /^\d+$/.test(price.trim()) ? Number(price.trim()) : NaN;
      await act((db) => saveReward(db, { id: initial?.id, name, description, imageId, price: p, recurrence }));
      toast(initial ? 'تم حفظ التعديل' : 'تمت إضافة الجائزة', 'success');
      onDone();
    } catch (e) {
      toast(errMsg(e, 'تعذر الحفظ'), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="editor"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label>
        الاسم
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required placeholder="مثال: فيلم في السينما" />
      </label>
      <ImagePicker value={imageId} onChange={setImageId} purpose="reward" />
      <label>
        الثمن بالـCoins
        <input inputMode="numeric" pattern="\d*" value={price} onChange={(e) => setPrice(e.target.value)} required />
      </label>
      <label>
        وصف (اختياري)
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={500} />
      </label>
      <fieldset className="radio-row">
        <legend>التكرار</legend>
        <label>
          <input type="radio" checked={recurrence === 'repeat'} onChange={() => setRecurrence('repeat')} /> متكررة
        </label>
        <label>
          <input type="radio" checked={recurrence === 'once'} onChange={() => setRecurrence('once')} /> مرة واحدة
        </label>
      </fieldset>
      <div className="editor-actions">
        <button className="btn btn-primary" type="submit" disabled={busy}>
          حفظ
        </button>
        <button className="btn btn-ghost" type="button" onClick={onDone}>
          رجوع
        </button>
      </div>
    </form>
  );
}

function ChallengesSection({ data, editId }: { data: AppData; editId?: string }) {
  const [editing, setEditing] = useState<string | null>(editId ?? null);
  const [showArchived, setShowArchived] = useState(false);
  if (editing) {
    const initial = editing === 'new' ? undefined : data.challenges.find((c) => c.id === editing);
    return <ChallengeEditor key={editing} initial={initial} onDone={() => setEditing(null)} />;
  }
  const active = data.challenges.filter((c) => !c.archived);
  const archived = data.challenges.filter((c) => c.archived);
  const onceDone = new Set(data.completions.filter((c) => c.kind === 'once').map((c) => c.challengeId));
  return (
    <div>
      <button className="btn btn-primary wide" onClick={() => setEditing('new')}>
        <Icon name="plus" size={18} /> تحدٍّ جديد
      </button>
      <ul className="manage-list">
        {active.map((c) => (
          <li key={c.id}>
            <BlobImg id={c.imageId} alt="" className="thumb" fallback="target" />
            <div className="grow">
              <strong>{c.name}</strong>
              <span className="muted small">
                {DIFFICULTY_LABEL[c.difficulty]} · {c.recurrence === 'daily' ? 'يومي' : onceDone.has(c.id) ? 'مرة واحدة — مكتمل' : 'مرة واحدة'}
              </span>
            </div>
            <button className="icon-btn" aria-label={`تعديل ${c.name}`} onClick={() => setEditing(c.id)}>
              <Icon name="edit" />
            </button>
            <button
              className="icon-btn danger"
              aria-label={`أرشفة ${c.name}`}
              onClick={async () => {
                const ok = await confirmDialog({
                  title: `أرشفة «${c.name}»؟`,
                  body: <p>يختفي من القائمة النشطة. السجل والمكافآت والأرصدة المكتسبة تبقى كما هي.</p>,
                  confirmText: 'أرشفة',
                  tone: 'danger',
                });
                if (ok) await act((db) => archiveChallenge(db, c.id));
              }}
            >
              <Icon name="trash" />
            </button>
          </li>
        ))}
      </ul>
      {!active.length ? <p className="muted center">لا توجد تحديات بعد.</p> : null}
      {archived.length ? (
        <>
          <button className="link-btn" onClick={() => setShowArchived((v) => !v)}>
            المؤرشفة (<Num>{archived.length}</Num>)
          </button>
          {showArchived ? (
            <ul className="manage-list muted">
              {archived.map((c) => (
                <li key={c.id}>
                  <span className="grow">{c.name}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function RewardsSection({ data, editId }: { data: AppData; editId?: string }) {
  const [editing, setEditing] = useState<string | null>(editId ?? null);
  if (editing) {
    const initial = editing === 'new' ? undefined : data.rewards.find((c) => c.id === editing);
    return <RewardEditor key={editing} initial={initial} onDone={() => setEditing(null)} />;
  }
  const active = data.rewards.filter((r) => !r.archived);
  return (
    <div>
      <button className="btn btn-primary wide" onClick={() => setEditing('new')}>
        <Icon name="plus" size={18} /> جائزة جديدة
      </button>
      <ul className="manage-list">
        {active.map((r) => (
          <li key={r.id}>
            <BlobImg id={r.imageId} alt="" className="thumb" fallback="gift" />
            <div className="grow">
              <strong>{r.name}</strong>
              <span className="muted small">
                <Num>{fmt(r.price)}</Num> Coins · {r.recurrence === 'once' ? (data.purchasedOnce.includes(r.id) ? 'مرة واحدة — مشتراة' : 'مرة واحدة') : 'متكررة'}
              </span>
            </div>
            <button className="icon-btn" aria-label={`تعديل ${r.name}`} onClick={() => setEditing(r.id)}>
              <Icon name="edit" />
            </button>
            <button
              className="icon-btn danger"
              aria-label={`أرشفة ${r.name}`}
              onClick={async () => {
                const ok = await confirmDialog({ title: `أرشفة «${r.name}»؟`, body: <p>تختفي من المتجر؛ المشتريات السابقة تبقى في السجل.</p>, confirmText: 'أرشفة', tone: 'danger' });
                if (ok) await act((db) => archiveReward(db, r.id));
              }}
            >
              <Icon name="trash" />
            </button>
          </li>
        ))}
      </ul>
      {!active.length ? <p className="muted center">لا توجد جوائز بعد.</p> : null}
    </div>
  );
}

function fmtTime(s: number) {
  if (!Number.isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function MusicSection({ data }: { data: AppData }) {
  const m = useMusic();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  async function importFiles(files: FileList) {
    const bad: string[] = [];
    let added = 0;
    for (const f of Array.from(files)) {
      setBusy(`جارٍ إضافة ${f.name}…`);
      const ok = await probeAudio(f);
      if (!ok) {
        bad.push(f.name);
        continue;
      }
      try {
        await addTrack(getDb(), await readFile(f));
        added++;
      } catch (e) {
        toast(errMsg(e, `تعذر حفظ ${f.name}`), 'error');
        break;
      }
    }
    setBusy(null);
    await refresh();
    if (added) toast(`أُضيفت ${added} أغنية`, 'success');
    if (bad.length) toast(`صيغة غير مدعومة في هذا المتصفح: ${bad.join('، ')}`, 'error');
  }
  const tracks = data.tracks;
  const move = async (i: number, d: -1 | 1) => {
    const ids = tracks.map((t) => t.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await act((db) => reorderTracks(db, ids));
  };
  return (
    <div>
      <div className="player card">
        <div className="player-now">
          <Icon name="music" />
          <div className="grow">
            <strong>{tracks[m.index]?.name ?? 'لا توجد أغاني'}</strong>
            <span className="muted small">
              <Num>
                {fmtTime(m.currentTime)} / {fmtTime(m.duration)}
              </Num>
            </span>
          </div>
        </div>
        <div className="player-controls" dir="ltr">
          <button className="icon-btn" aria-label="السابق" onClick={() => music.prev()} disabled={!tracks.length}>
            <Icon name="prev" />
          </button>
          <button className="icon-btn big" aria-label={m.playing ? 'إيقاف مؤقت' : 'تشغيل'} onClick={() => (m.needsTap ? void music.play() : music.toggle())} disabled={!tracks.length}>
            <Icon name={m.playing ? 'pause' : 'play'} size={30} />
          </button>
          <button className="icon-btn" aria-label="التالي" onClick={() => music.next()} disabled={!tracks.length}>
            <Icon name="next" />
          </button>
        </div>
        {m.needsTap ? <p className="small warn">المتصفح أوقف التشغيل التلقائي؛ اضغط تشغيل للمتابعة.</p> : null}
        {m.error ? <p className="small warn">{m.error}</p> : null}
        <label className="slider">
          <Icon name="volume" size={18} /> مستوى الموسيقى
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={data.settings.musicVolume}
            onChange={(e) => {
              const v = Number(e.target.value);
              music.setVolume(v);
              void act((db) => saveSettings(db, { musicVolume: v }));
            }}
          />
        </label>
        <label className="switch">
          <input
            type="checkbox"
            checked={data.settings.musicLoop}
            onChange={(e) => {
              music.setLoop(e.target.checked);
              void act((db) => saveSettings(db, { musicLoop: e.target.checked }));
            }}
          />
          تكرار اللائحة
        </label>
        <p className="muted small">الموسيقى تعمل أثناء استعمال التطبيق فقط، وتتوقف عند إخفائه أو إطفاء الشاشة.</p>
      </div>
      <button className="btn btn-primary wide" onClick={() => ref.current?.click()} disabled={!!busy}>
        <Icon name="plus" size={18} /> استيراد أغاني من الهاتف
      </button>
      <input
        ref={ref}
        type="file"
        accept="audio/*"
        multiple
        hidden
        data-testid="music-input"
        onChange={(e) => {
          const files = e.target.files;
          if (files?.length) void importFiles(files);
          e.target.value = '';
        }}
      />
      {busy ? <p className="muted small">{busy}</p> : null}
      <ol className="manage-list tracks">
        {tracks.map((t, i) => (
          <li key={t.id} className={i === m.index ? 'current' : ''}>
            <button className="icon-btn" aria-label={`تشغيل ${t.name}`} onClick={() => void music.play(i)}>
              <Icon name={i === m.index && m.playing ? 'pause' : 'play'} size={18} />
            </button>
            <div className="grow">
              <strong>{t.name}</strong>
              <span className="muted small">
                <Num>{(t.size / 1e6).toFixed(1)} MB</Num>
                {m.unsupported.includes(t.id) ? ' · غير مدعومة هنا' : ''}
              </span>
            </div>
            <button className="icon-btn" aria-label="أعلى" onClick={() => void move(i, -1)} disabled={i === 0}>
              <Icon name="up" size={18} />
            </button>
            <button className="icon-btn" aria-label="أسفل" onClick={() => void move(i, 1)} disabled={i === tracks.length - 1}>
              <Icon name="down" size={18} />
            </button>
            <button
              className="icon-btn danger"
              aria-label={`حذف ${t.name}`}
              onClick={async () => {
                const ok = await confirmDialog({ title: `حذف «${t.name}»؟`, body: <p>يُحذف الملف من تخزين التطبيق على هذا الجهاز.</p>, confirmText: 'حذف', tone: 'danger' });
                if (ok) await act((db) => removeTrack(db, t.id));
              }}
            >
              <Icon name="trash" size={18} />
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function SoundSection({ settings }: { settings: Settings }) {
  return (
    <div className="card pad">
      <label className="slider">
        <Icon name="volume" size={18} /> مستوى أصوات اللعبة
        <input type="range" min={0} max={1} step={0.05} value={settings.sfxVolume} onChange={(e) => void act((db) => saveSettings(db, { sfxVolume: Number(e.target.value) }))} />
      </label>
      <label className="switch">
        <input type="checkbox" checked={settings.sfxMuted} onChange={(e) => void act((db) => saveSettings(db, { sfxMuted: e.target.checked }))} />
        كتم أصوات اللعبة
      </label>
      <button className="btn btn-ghost" onClick={() => sfx.confirm()}>
        تجربة الصوت
      </button>
      <p className="muted small">مستوى أصوات اللعبة مستقل عن مستوى الموسيقى.</p>
    </div>
  );
}

function LookSection({ settings }: { settings: Settings }) {
  return (
    <div className="card pad">
      <fieldset className="radio-row col">
        <legend>تقليل الحركة</legend>
        {(
          [
            ['system', 'حسب إعداد الجهاز'],
            ['on', 'مفعّل (حركة أقل)'],
            ['off', 'متوقف (كل المؤثرات)'],
          ] as const
        ).map(([v, l]) => (
          <label key={v}>
            <input type="radio" checked={settings.reduceMotion === v} onChange={() => void act((db) => saveSettings(db, { reduceMotion: v }))} /> {l}
          </label>
        ))}
      </fieldset>
      <fieldset className="radio-row">
        <legend>سرعة عرض القتال</legend>
        {([1, 2] as const).map((v) => (
          <label key={v}>
            <input type="radio" checked={settings.battleSpeed === v} onChange={() => void act((db) => saveSettings(db, { battleSpeed: v }))} /> ×<Num>{v}</Num>
          </label>
        ))}
      </fieldset>
      <p className="muted small">السرعة وتقليل الحركة لا يغيران نتيجة أي معركة؛ الأرقام والحالات تبقى ظاهرة.</p>
    </div>
  );
}

function DataSection({ data }: { data: AppData }) {
  const [status, setStatus] = useState<AssetStatus | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [dlError, setDlError] = useState<string | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void assetStatus().then(setStatus);
    void storageEstimate().then(setUsage);
    void navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
    return () => abortRef.current?.abort();
  }, []);

  async function download() {
    setDlError(null);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await downloadAssets(setProgress, ac.signal);
      const st = await assetStatus();
      setStatus(st);
      if (st.ready) {
        await setMeta(getDb(), 'assetsReady', { at: Date.now(), count: st.total });
        await refresh();
        const p = await requestPersistentStorage();
        setPersisted(p);
        toast('كل الصور جاهزة للعمل دون إنترنت', 'success');
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setDlError((e as Error).message);
      setStatus(await assetStatus());
    } finally {
      setProgress(null);
      void storageEstimate().then(setUsage);
    }
  }

  async function doExport() {
    setBusy('جارٍ تجهيز النسخة الاحتياطية…');
    try {
      const { bytes, filename } = await exportBackup(getDb());
      const blob = new Blob([bytes as BlobPart], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      toast('تم تنزيل النسخة الاحتياطية', 'success');
    } catch (e) {
      toast(errMsg(e, 'تعذر إنشاء النسخة'), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function doImport(f: File) {
    setBusy('جارٍ فحص الملف…');
    try {
      const parsed = await parseBackup(await f.arrayBuffer());
      setBusy(null);
      const p = (parsed.data.profile[0] ?? {}) as { xp?: number; coins?: number; gems?: number };
      const ok = await confirmDialog({
        title: 'استبدال كل البيانات بهذه النسخة؟',
        body: (
          <div>
            <p>ستُستبدل كل بياناتك الحالية على هذا الجهاز (التحديات والجوائز والتقدم والموسيقى والمعركة) بمحتوى النسخة. لا يتم الدمج.</p>
            <p className="small">
              النسخة: <Num>{new Date(parsed.manifest.exportedAt).toLocaleString()}</Num> · XP <Num>{fmt(p.xp ?? 0)}</Num> · Coins <Num>{fmt(p.coins ?? 0)}</Num> · جواهر <Num>{fmt(p.gems ?? 0)}</Num>
            </p>
            <p className="small muted">إذا فشل الاسترجاع لأي سبب تبقى بياناتك الحالية كما هي.</p>
          </div>
        ),
        confirmText: 'استبدال',
        tone: 'danger',
      });
      if (!ok) return;
      setBusy('جارٍ الاسترجاع…');
      music.stop();
      await importBackup(getDb(), parsed);
      await refresh();
      toast('تم استرجاع النسخة الاحتياطية', 'success');
    } catch (e) {
      toast(errMsg(e, 'تعذر قراءة الملف؛ لم تتغير بياناتك'), 'error');
    } finally {
      setBusy(null);
    }
  }

  const pct = progress ? Math.floor((progress.bytesDone / progress.bytesTotal) * 100) : status ? Math.floor((status.bytesCached / status.bytesTotal) * 100) : 0;
  return (
    <div className="data-section">
      <div className="card pad">
        <h3>العمل دون إنترنت</h3>
        {status && !status.supported ? (
          <p className="warn small">هذا المتصفح لا يدعم تخزين الصور للعمل دون إنترنت.</p>
        ) : status?.ready ? (
          <p className="ok">
            <Icon name="check" size={18} /> جاهز بلا إنترنت: كل صور الأبطال والمستويات والبطاقات محفوظة على الجهاز.
          </p>
        ) : (
          <p className="small">
            نزّل صور اللعبة (<Num>{status ? (status.bytesTotal / 1e6).toFixed(0) : '…'} MB</Num>) مرة واحدة لتعمل كل الصفحات والقتال دون شبكة.
          </p>
        )}
        {status && !status.ready && status.supported ? (
          <>
            <div className="bar bar-xp" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="تقدم التنزيل">
              <div className="bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <p className="small">
              <Num>{progress ? `${progress.done}/${progress.total}` : `${status.cached}/${status.total}`}</Num> ملف · <Num>{pct}%</Num>
            </p>
            {progress ? (
              <button className="btn btn-ghost" onClick={() => abortRef.current?.abort()}>
                إيقاف
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => void download()} data-testid="download-assets">
                <Icon name="download" size={18} /> {status.cached ? 'متابعة التنزيل' : 'تنزيل صور اللعبة'}
              </button>
            )}
          </>
        ) : null}
        {dlError ? <p className="warn small">{dlError}</p> : null}
      </div>

      <div className="card pad">
        <h3>النسخ الاحتياطي</h3>
        <p className="small">
          تخزين المتصفح قد يُمسح من إعدادات الجهاز. احتفظ بنسخة احتياطية (ملف ZIP يشمل التقدم والسجل والصور والأغاني والمعركة الجارية).
        </p>
        <div className="row-btns">
          <button className="btn btn-primary" onClick={() => void doExport()} disabled={!!busy}>
            <Icon name="download" size={18} /> تصدير نسخة
          </button>
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()} disabled={!!busy}>
            <Icon name="upload" size={18} /> استرجاع نسخة
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".zip,application/zip"
          hidden
          data-testid="backup-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void doImport(f);
          }}
        />
        {busy ? <p className="muted small">{busy}</p> : null}
      </div>

      <div className="card pad">
        <h3>التخزين</h3>
        <p className="small">
          {persisted === true ? 'التخزين الدائم مفعّل.' : persisted === false ? 'التخزين الدائم غير مفعّل؛ قد يمسح المتصفح البيانات عند امتلاء الجهاز.' : 'حالة التخزين الدائم غير معروفة في هذا المتصفح.'}
        </p>
        {persisted === false ? (
          <button className="btn btn-ghost btn-small" onClick={() => void requestPersistentStorage().then(setPersisted)}>
            طلب تخزين دائم
          </button>
        ) : null}
        {usage ? (
          <p className="muted small">
            المستعمل <Num>{(usage.usage / 1e6).toFixed(0)} MB</Num> من <Num>{(usage.quota / 1e6).toFixed(0)} MB</Num>
          </p>
        ) : null}
        <p className="muted small">
          الإصدار <Num>1.0.0</Num> · مخطط البيانات <Num>{String(data.meta.schemaVersion ?? 1)}</Num>
          {CATALOG.problems.length ? ` · محتوى معزول: ${CATALOG.problems.length}` : ''}
        </p>
      </div>
    </div>
  );
}

export function SettingsSheet({ data, initial, onClose }: { data: AppData; initial: Extract<Overlay, { kind: 'settings' }>; onClose: () => void }) {
  const [section, setSection] = useState<Section>(initial.section ?? 'challenges');
  return (
    <Sheet title="الإعدادات" onClose={onClose} wide>
      <div className="settings-tabs" role="tablist">
        {SECTIONS.map((s) => (
          <button key={s.id} role="tab" aria-selected={section === s.id} className={`chip-btn ${section === s.id ? 'on' : ''}`} onClick={() => setSection(s.id)}>
            <Icon name={s.icon} size={16} /> {s.label}
          </button>
        ))}
      </div>
      <div className="settings-body">
        {section === 'challenges' && <ChallengesSection data={data} editId={initial.section === 'challenges' ? initial.editId : undefined} />}
        {section === 'rewards' && <RewardsSection data={data} editId={initial.section === 'rewards' ? initial.editId : undefined} />}
        {section === 'music' && <MusicSection data={data} />}
        {section === 'sound' && <SoundSection settings={data.settings} />}
        {section === 'look' && <LookSection settings={data.settings} />}
        {section === 'data' && <DataSection data={data} />}
      </div>
    </Sheet>
  );
}
