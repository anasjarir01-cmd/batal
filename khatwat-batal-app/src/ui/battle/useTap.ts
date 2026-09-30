// لمسة واحدة = اختيار، لمستان سريعتان = تكبير. اللمسة الواحدة تُؤجَّل قليلًا حتى لا تُحتسب
// اللمسة المزدوجة اختيارًا ثم إلغاءً (فلا تُستهلك الطاقة مرتين ولا يتغير الهدف دون قصد).
// السحب الأفقي لا يُحتسب لمسة. تفعيل لوحة المفاتيح (detail = 0) يُنفَّذ فورًا.
import { useEffect, useRef } from 'react';

export const DOUBLE_TAP_MS = 260;
const MOVE_TOLERANCE = 10;

export function useTap(onTap: () => void, onDoubleTap: () => void) {
  const tapRef = useRef(onTap);
  const dblRef = useRef(onDoubleTap);
  tapRef.current = onTap;
  dblRef.current = onDoubleTap;
  const timer = useRef<number | null>(null);
  const down = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  return {
    onPointerDown(e: React.PointerEvent) {
      down.current = { x: e.clientX, y: e.clientY };
      moved.current = false;
    },
    onPointerMove(e: React.PointerEvent) {
      const d = down.current;
      if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > MOVE_TOLERANCE) moved.current = true;
    },
    onClick(e: React.MouseEvent) {
      if (moved.current) {
        moved.current = false;
        return;
      }
      if (e.detail === 0) {
        tapRef.current();
        return;
      }
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
        dblRef.current();
        return;
      }
      timer.current = window.setTimeout(() => {
        timer.current = null;
        tapRef.current();
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
