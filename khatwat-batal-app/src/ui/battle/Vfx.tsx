// مؤثرات 2D خفيفة فوق الساحة: عائلات مشتركة تُلوّن حسب النوع وتوضع على الأهداف.
// للعرض فقط؛ لا مصدر لأي عشوائية أو حساب.
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import type { VfxFamily } from '../../catalog/types';
import type { UnitRef } from '../../engine/battle/types';

export type FxKind = VfxFamily | 'number' | 'text' | 'dot-pulse' | 'shake' | 'fall';

export interface FxSpec {
  kind: FxKind;
  at: UnitRef;
  from?: UnitRef;
  text?: string;
  tone?: 'dmg' | 'heal' | 'absorb' | 'info' | 'burn' | 'poison' | 'bleed' | 'buff' | 'debuff';
  delay?: number;
  duration?: number;
}

interface LiveFx extends FxSpec {
  id: number;
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  w: number;
  h: number;
}

export interface VfxHandle {
  spawn(items: FxSpec[], speed: number, reduced: boolean): void;
  clear(): void;
}

let seq = 0;

export const VfxLayer = forwardRef<VfxHandle, { rootRef: React.RefObject<HTMLElement | null> }>(function VfxLayer({ rootRef }, ref) {
  const [items, setItems] = useState<LiveFx[]>([]);
  const timers = useRef<number[]>([]);

  const locate = (u: UnitRef) => {
    const root = rootRef.current;
    if (!root) return null;
    const el = root.querySelector<HTMLElement>(`[data-unit="${u === 'boss' ? 'boss' : `h${u}`}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    return { x: r.left - rr.left + r.width / 2, y: r.top - rr.top + r.height / 2, w: r.width, h: r.height, el };
  };

  useImperativeHandle(ref, () => ({
    spawn(specs, speed, reduced) {
      const created: LiveFx[] = [];
      for (const s of specs) {
        const p = locate(s.at);
        if (!p) continue;
        if (s.kind === 'shake') {
          if (!reduced) {
            p.el.classList.remove('fx-shake');
            void p.el.offsetWidth;
            p.el.classList.add('fx-shake');
            const t = window.setTimeout(() => p.el.classList.remove('fx-shake'), 450);
            timers.current.push(t);
          }
          continue;
        }
        const f = s.from !== undefined ? locate(s.from) : null;
        const baseDur = s.duration ?? (s.kind === 'number' || s.kind === 'text' ? 1100 : 750);
        const fx: LiveFx = {
          ...s,
          id: ++seq,
          x: p.x,
          y: s.kind === 'number' || s.kind === 'text' ? p.y - p.h * 0.15 : p.y,
          x2: f?.x,
          y2: f?.y,
          w: p.w,
          h: p.h,
          delay: (s.delay ?? 0) / speed,
          duration: reduced && s.kind !== 'number' && s.kind !== 'text' ? 300 : baseDur / speed,
        };
        created.push(fx);
      }
      if (!created.length) return;
      setItems((cur) => [...cur, ...created]);
      const maxEnd = Math.max(...created.map((c) => (c.delay ?? 0) + (c.duration ?? 800))) + 80;
      const t = window.setTimeout(() => setItems((cur) => cur.filter((c) => !created.includes(c))), maxEnd);
      timers.current.push(t);
    },
    clear() {
      timers.current.forEach((t) => clearTimeout(t));
      timers.current = [];
      setItems([]);
    },
  }));

  return (
    <div className="vfx-layer" aria-hidden="true">
      {items.map((f) => {
        const style: React.CSSProperties & Record<string, string | number> = {
          left: f.x,
          top: f.y,
          animationDelay: `${f.delay}ms`,
          animationDuration: `${f.duration}ms`,
          '--w': `${Math.min(f.w, 180)}px`,
          '--h': `${Math.min(f.h, 180)}px`,
        };
        if (f.x2 !== undefined && f.y2 !== undefined) {
          style['--dx'] = `${f.x2 - f.x}px`;
          style['--dy'] = `${f.y2 - f.y}px`;
          const len = Math.hypot(f.x2 - f.x, f.y2 - f.y);
          const ang = (Math.atan2(f.y2 - f.y, f.x2 - f.x) * 180) / Math.PI;
          style['--len'] = `${len}px`;
          style['--ang'] = `${ang}deg`;
        }
        return (
          <span key={f.id} className={`fx fx-${f.kind} ${f.tone ? `tone-${f.tone}` : ''}`} style={style}>
            {f.text ? <bdi>{f.text}</bdi> : null}
            {f.kind === 'claw' ? (
              <>
                <i />
                <i />
                <i />
              </>
            ) : null}
            {f.kind === 'fire' || f.kind === 'heal' || f.kind === 'cleanse' ? (
              <>
                <i />
                <i />
                <i />
                <i />
                <i />
              </>
            ) : null}
          </span>
        );
      })}
    </div>
  );
});
