// أصوات قصيرة مولّدة محليًا بـWebAudio (بلا ملفات خارجية). مستواها مستقل عن الموسيقى.
// تُوقف عند إخفاء التطبيق، ولا تؤثر في أي حساب.
import type { VfxFamily } from '../catalog/types';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let volume = 0.7;
let muted = false;

export function configureSfx(v: number, m: boolean) {
  volume = v;
  muted = m;
  if (master) master.gain.value = muted ? 0 : volume;
}

function ensure(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended' && document.visibilityState === 'visible') void ctx.resume().catch(() => undefined);
  return ctx;
}

document.addEventListener('visibilitychange', () => {
  if (!ctx) return;
  if (document.visibilityState === 'hidden') void ctx.suspend().catch(() => undefined);
  else void ctx.resume().catch(() => undefined);
});

function tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.25, slideTo?: number, delay = 0) {
  const c = ensure();
  if (!c || !master || muted || document.visibilityState === 'hidden') return;
  const t0 = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(dur: number, gain = 0.2, filterFreq = 1800, type: BiquadFilterType = 'bandpass', delay = 0, sweepTo?: number) {
  const c = ensure();
  if (!c || !master || muted || document.visibilityState === 'hidden') return;
  const t0 = c.currentTime + delay;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(filterFreq, t0);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
}

export const sfx = {
  select: () => tone(880, 0.07, 'triangle', 0.12),
  deselect: () => tone(520, 0.07, 'triangle', 0.1),
  confirm: () => {
    tone(660, 0.09, 'triangle', 0.14);
    tone(990, 0.12, 'triangle', 0.12, undefined, 0.07);
  },
  coin: () => {
    tone(1200, 0.08, 'square', 0.06);
    tone(1600, 0.14, 'square', 0.05, undefined, 0.06);
  },
  levelUp: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.18, 'triangle', 0.14, undefined, i * 0.09)),
  flip: () => noise(0.12, 0.12, 3000, 'highpass'),
  hit: () => {
    noise(0.14, 0.25, 900);
    tone(140, 0.16, 'sine', 0.25, 70);
  },
  slash: () => noise(0.18, 0.22, 4000, 'bandpass', 0, 1200),
  arrow: () => noise(0.2, 0.14, 2500, 'bandpass', 0, 6000),
  fire: () => {
    noise(0.35, 0.18, 700, 'lowpass');
    tone(220, 0.25, 'sawtooth', 0.05, 110);
  },
  shield: () => {
    tone(740, 0.22, 'sine', 0.14);
    tone(1110, 0.18, 'sine', 0.08, undefined, 0.03);
  },
  shieldBreak: () => noise(0.25, 0.2, 5000, 'highpass'),
  heal: () => [660, 880, 1320].forEach((f, i) => tone(f, 0.22, 'sine', 0.1, undefined, i * 0.07)),
  buff: () => tone(440, 0.22, 'triangle', 0.12, 880),
  debuff: () => tone(660, 0.25, 'triangle', 0.12, 260),
  poison: () => [300, 360, 280].forEach((f, i) => tone(f, 0.09, 'sine', 0.1, undefined, i * 0.06)),
  mirror: () => {
    tone(1500, 0.3, 'sine', 0.08, 2400);
    tone(1900, 0.25, 'sine', 0.06, undefined, 0.05);
  },
  fall: () => tone(300, 0.5, 'sine', 0.16, 90),
  victory: () => [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.25, 'triangle', 0.14, undefined, i * 0.11)),
  defeat: () => [392, 330, 262].forEach((f, i) => tone(f, 0.35, 'sine', 0.14, undefined, i * 0.18)),
};

export function sfxForFamily(f: VfxFamily) {
  switch (f) {
    case 'slash':
    case 'claw':
    case 'bite':
      return sfx.slash();
    case 'arrow':
    case 'arrow-pierce':
      return sfx.arrow();
    case 'fire':
    case 'sun':
      return sfx.fire();
    case 'shield':
      return sfx.shield();
    case 'barrier-break':
      return sfx.shieldBreak();
    case 'heal':
    case 'cleanse':
      return sfx.heal();
    case 'buff':
    case 'mark':
    case 'expose':
      return sfx.buff();
    case 'debuff':
    case 'howl':
      return sfx.debuff();
    case 'poison':
    case 'bleed':
    case 'thread':
      return sfx.poison();
    case 'mirror':
      return sfx.mirror();
    case 'quake':
      return sfx.hit();
  }
}
