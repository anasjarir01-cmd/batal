// مشغل موسيقى واحد على مستوى التطبيق، خارج شجرة React فلا يُعاد إنشاؤه عند تغيير الصفحة.
// يعمل أثناء استعمال التطبيق فقط: يتوقف عند الإخفاء ويستأنف عند الرجوع إذا كان يعمل قبله ولم يوقفه المستخدم.
import { useSyncExternalStore } from 'react';
import { getDb } from '../store/appStore';
import { getBlob, setMeta } from '../store/ops';
import type { MusicPosition, Track } from '../store/types';

export interface MusicState {
  tracks: Track[];
  index: number;
  playing: boolean;
  /** منع المتصفح التشغيل التلقائي: يلزم ضغط زر المتابعة. */
  needsTap: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  loop: boolean;
  error: string | null;
  unsupported: string[];
}

class MusicPlayer {
  private audio: HTMLAudioElement | null = null;
  private url: string | null = null;
  private loadedTrackId: string | null = null;
  private userPaused = true;
  private wasPlayingBeforeHidden = false;
  private listeners = new Set<() => void>();
  private lastSave = 0;
  state: MusicState = { tracks: [], index: 0, playing: false, needsTap: false, currentTime: 0, duration: 0, volume: 0.6, loop: true, error: null, unsupported: [] };
  private resumeAt: MusicPosition | null = null;

  private set(patch: Partial<MusicState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getState = () => this.state;

  private el(): HTMLAudioElement {
    if (!this.audio) {
      const a = new Audio();
      a.preload = 'auto';
      a.volume = this.state.volume;
      a.addEventListener('ended', () => void this.onEnded());
      a.addEventListener('timeupdate', () => {
        this.set({ currentTime: a.currentTime, duration: Number.isFinite(a.duration) ? a.duration : 0 });
        if (Date.now() - this.lastSave > 5000) this.savePosition();
      });
      a.addEventListener('play', () => this.set({ playing: true, needsTap: false }));
      a.addEventListener('pause', () => this.set({ playing: false }));
      a.addEventListener('error', () => this.onError());
      this.audio = a;
      document.addEventListener('visibilitychange', this.onVisibility);
      window.addEventListener('pagehide', () => this.savePosition());
    }
    return this.audio;
  }

  init(tracks: Track[], volume: number, loop: boolean, position: MusicPosition | null) {
    const curId = this.state.tracks[this.state.index]?.id;
    let index = curId ? tracks.findIndex((t) => t.id === curId) : -1;
    if (index < 0 && position) index = tracks.findIndex((t) => t.id === position.trackId);
    if (index < 0) index = 0;
    if (!this.loadedTrackId && position) this.resumeAt = position;
    this.set({ tracks, index: Math.min(index, Math.max(0, tracks.length - 1)), volume, loop });
    if (this.audio) this.audio.volume = volume;
    if (this.loadedTrackId && !tracks.some((t) => t.id === this.loadedTrackId)) {
      this.stop();
    }
  }

  private async load(i: number): Promise<HTMLAudioElement | null> {
    const t = this.state.tracks[i];
    if (!t) return null;
    const a = this.el();
    if (this.loadedTrackId === t.id) return a;
    const rec = await getBlob(getDb(), t.blobId);
    if (!rec) {
      this.set({ error: `الملف غير موجود: ${t.name}` });
      return null;
    }
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(new Blob([rec.data], { type: rec.type || 'audio/mpeg' }));
    a.src = this.url;
    this.loadedTrackId = t.id;
    if (this.resumeAt && this.resumeAt.trackId === t.id) {
      const at = this.resumeAt.time;
      a.addEventListener('loadedmetadata', () => (a.currentTime = at), { once: true });
    }
    this.resumeAt = null;
    return a;
  }

  async play(i = this.state.index) {
    if (!this.state.tracks.length) return;
    this.userPaused = false;
    this.set({ index: i, error: null });
    const a = await this.load(i);
    if (!a) return;
    try {
      await a.play();
      this.set({ needsTap: false });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotAllowedError') this.set({ needsTap: true });
      else this.onError();
    }
  }

  pause(byUser = true) {
    if (byUser) this.userPaused = true;
    this.audio?.pause();
    this.savePosition();
  }

  toggle() {
    if (this.state.playing) this.pause();
    else void this.play();
  }

  next() {
    if (!this.state.tracks.length) return;
    const n = (this.state.index + 1) % this.state.tracks.length;
    this.loadedTrackId = null;
    void this.play(n);
  }

  prev() {
    if (!this.state.tracks.length) return;
    const a = this.audio;
    if (a && a.currentTime > 3) {
      a.currentTime = 0;
      return;
    }
    const n = (this.state.index - 1 + this.state.tracks.length) % this.state.tracks.length;
    this.loadedTrackId = null;
    void this.play(n);
  }

  setVolume(v: number) {
    this.set({ volume: v });
    if (this.audio) this.audio.volume = v;
  }

  setLoop(loop: boolean) {
    this.set({ loop });
  }

  stop() {
    this.audio?.pause();
    this.loadedTrackId = null;
    this.userPaused = true;
    this.set({ playing: false, currentTime: 0 });
  }

  private async onEnded() {
    const last = this.state.index >= this.state.tracks.length - 1;
    if (last && !this.state.loop) {
      this.userPaused = true;
      this.set({ playing: false });
      return;
    }
    this.next();
  }

  private onError() {
    const t = this.state.tracks[this.state.index];
    if (!t) return;
    const unsupported = Array.from(new Set([...this.state.unsupported, t.id]));
    this.set({ error: `تعذر تشغيل «${t.name}»؛ قد تكون صيغته غير مدعومة في هذا المتصفح.`, unsupported, playing: false });
    // لا تعطل بقية اللائحة: انتقل للتالي إن وُجد ملف لم يفشل
    const ok = this.state.tracks.filter((x) => !unsupported.includes(x.id));
    if (ok.length && !this.userPaused) {
      const nextIdx = this.state.tracks.findIndex((x, i) => i > this.state.index && !unsupported.includes(x.id));
      const target = nextIdx >= 0 ? nextIdx : this.state.tracks.findIndex((x) => !unsupported.includes(x.id));
      this.loadedTrackId = null;
      void this.play(target);
    }
  }

  private savePosition() {
    const t = this.state.tracks[this.state.index];
    if (!t || !this.audio) return;
    this.lastSave = Date.now();
    try {
      void setMeta(getDb(), 'musicPosition', { trackId: t.id, time: this.audio.currentTime } satisfies MusicPosition);
    } catch {
      /* قاعدة البيانات غير جاهزة */
    }
  }

  private onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      this.wasPlayingBeforeHidden = this.state.playing && !this.userPaused;
      if (this.state.playing) {
        this.audio?.pause();
        this.savePosition();
      }
    } else if (this.wasPlayingBeforeHidden && !this.userPaused) {
      this.wasPlayingBeforeHidden = false;
      void this.play(this.state.index);
    }
  };
}

export const music = new MusicPlayer();

export function useMusic(): MusicState {
  return useSyncExternalStore(music.subscribe, music.getState);
}

/** يفحص إن كان المتصفح يستطيع تشغيل الملف قبل تخزينه. */
export function probeAudio(file: File): Promise<boolean> {
  return new Promise((resolve) => {
    const a = new Audio();
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      a.removeAttribute('src');
      resolve(ok);
    };
    // لا نعتمد على canPlayType وحده: النوع قد يكون فارغًا أو غير دقيق، فنجرب التحميل الفعلي
    a.addEventListener('loadedmetadata', () => finish(true), { once: true });
    a.addEventListener('canplay', () => finish(true), { once: true });
    a.addEventListener('error', () => finish(false), { once: true });
    setTimeout(() => finish(false), 8000);
    a.preload = 'metadata';
    a.src = url;
  });
}
