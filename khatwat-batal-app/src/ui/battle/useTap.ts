// إيماءات البطاقة: لمستان سريعتان = تكبير، إمساك قصير = حمل البطاقة لسحبها.
// اللمسة الواحدة تُؤجَّل قليلًا حتى لا تُحتسب اللمستان لمسة ثم لمسة. الحركة قبل الإمساك تترك
// الإصبع لتصفح اليد (ولا تُحتسب لمسة). تفعيل لوحة المفاتيح (detail = 0) يُنفَّذ فورًا.
import { useEffect, useRef } from 'react';

export const DOUBLE_TAP_MS = 260;
export const HOLD_MS = 260;
const MOVE_TOLERANCE = 8;

export type TapSource = 'pointer' | 'key';
export interface DragStart {
  pointerId: number;
  x: number;
  y: number;
  el: HTMLElement;
}

interface Opts {
  onTap: (src: TapSource) => void;
  onDoubleTap: () => void;
  /** بدء الحمل؛ يعيد true إذا بدأ السحب فعلًا. */
  onDrag?: (d: DragStart) => boolean;
  /** بدء السحب أيضًا بمجرد تحريك الإصبع (حيث لا تمرير يتعارض معه، كخانات الخطة). */
  dragOnMove?: boolean;
}

export function useCardGesture(opts: Opts) {
  const o = useRef(opts);
  o.current = opts;
  const tapTimer = useRef<number | null>(null);
  const holdTimer = useRef<number | null>(null);
  const down = useRef<{ id: number; x: number; y: number; lx: number; ly: number; el: HTMLElement } | null>(null);
  const moved = useRef(false);
  const consumed = useRef(false);

  const clearHold = () => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };
  useEffect(
    () => () => {
      if (tapTimer.current !== null) window.clearTimeout(tapTimer.current);
      clearHold();
    },
    [],
  );

  const startDrag = () => {
    const d = down.current;
    if (!d || !o.current.onDrag) return;
    if (o.current.onDrag({ pointerId: d.id, x: d.lx, y: d.ly, el: d.el })) {
      consumed.current = true;
      // اللمسة المعلقة (إن وُجدت) لا تُنفَّذ بعد بدء الحمل
      if (tapTimer.current !== null) window.clearTimeout(tapTimer.current);
      tapTimer.current = null;
    }
  };

  return {
    onPointerDown(e: React.PointerEvent<HTMLElement>) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      down.current = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, el: e.currentTarget };
      moved.current = false;
      consumed.current = false;
      clearHold();
      if (o.current.onDrag) {
        holdTimer.current = window.setTimeout(() => {
          holdTimer.current = null;
          if (!moved.current) startDrag();
        }, HOLD_MS);
      }
    },
    onPointerMove(e: React.PointerEvent<HTMLElement>) {
      const d = down.current;
      if (!d || d.id !== e.pointerId) return;
      d.lx = e.clientX;
      d.ly = e.clientY;
      if (!moved.current && Math.hypot(e.clientX - d.x, e.clientY - d.y) > MOVE_TOLERANCE) {
        moved.current = true;
        const waiting = holdTimer.current !== null;
        clearHold();
        if (waiting && o.current.dragOnMove) startDrag();
      }
    },
    onPointerUp() {
      clearHold();
      down.current = null;
    },
    onPointerCancel() {
      clearHold();
      down.current = null;
    },
    onClick(e: React.MouseEvent) {
      if (consumed.current) {
        consumed.current = false;
        e.preventDefault();
        return;
      }
      if (moved.current) {
        moved.current = false;
        return;
      }
      if (e.detail === 0) {
        o.current.onTap('key');
        return;
      }
      if (tapTimer.current !== null) {
        window.clearTimeout(tapTimer.current);
        tapTimer.current = null;
        o.current.onDoubleTap();
        return;
      }
      tapTimer.current = window.setTimeout(() => {
        tapTimer.current = null;
        o.current.onTap('pointer');
      }, DOUBLE_TAP_MS);
    },
    onDoubleClick(e: React.MouseEvent) {
      e.preventDefault();
    },
    onContextMenu(e: React.MouseEvent) {
      e.preventDefault();
    },
  };
}

/** لمسة/لمستان فقط، بلا سحب (بطاقات الزعيم). */
export function useTap(onTap: () => void, onDoubleTap: () => void) {
  return useCardGesture({ onTap: () => onTap(), onDoubleTap });
}
