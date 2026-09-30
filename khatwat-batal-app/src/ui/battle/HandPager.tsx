// يد القدرات: صف واحد يُظهر أربع بطاقات كاملة؛ السحب بالإصبع نحو اليمين يكشف الأربع الباقية (RTL)
// وبالعكس يعود. الانتقال محسوب بـtransform صريح، لا بافتراض اتجاه scrollLeft.
// لا أزرار ولا نقاط ولا عداد صفحات؛ التنقل بلوحة المفاتيح ينقل الصفحة إلى البطاقة المركَّز عليها.
// التصفح لا يسحب أي بطاقة من الرزمة، والسحب لا يُحتسب لمسة على بطاقة. أثناء حمل بطاقة (blockRef) يثبت الصف.
import { useEffect, useRef, useState, type ReactNode } from 'react';

export const CARDS_PER_PAGE = 4;
const SWIPE_THRESHOLD = 40;

export function HandPager({
  items,
  render,
  resetKey,
  blockRef,
}: {
  items: string[];
  render: (id: string) => ReactNode;
  resetKey?: string;
  /** true أثناء حمل بطاقة: الصف لا يتحرك مع الإصبع. */
  blockRef?: React.RefObject<boolean>;
}) {
  const pages = Math.max(1, Math.ceil(items.length / CARDS_PER_PAGE));
  const [page, setPage] = useState(0);
  const [dragX, setDragX] = useState(0);
  const start = useRef<{ x: number; y: number; id: number; horizontal: boolean | null } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    if (page > pages - 1) setPage(pages - 1);
  }, [page, pages]);
  // جولة جديدة أو بدء العرض: العودة إلى أول أربع بطاقات
  useEffect(() => setPage(0), [resetKey]);

  const groups: string[][] = [];
  for (let i = 0; i < pages; i++) groups.push(items.slice(i * CARDS_PER_PAGE, (i + 1) * CARDS_PER_PAGE));

  const onDown = (e: React.PointerEvent) => {
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, horizontal: null };
    suppressClick.current = false;
  };
  const onMove = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    if (blockRef?.current) {
      start.current = null;
      setDragX(0);
      return;
    }
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (s.horizontal === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      s.horizontal = Math.abs(dx) > Math.abs(dy);
      if (s.horizontal) (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }
    if (s.horizontal) {
      suppressClick.current = true;
      // مقاومة عند الأطراف
      const atEdge = (dx > 0 && page === pages - 1) || (dx < 0 && page === 0);
      setDragX(atEdge ? dx * 0.25 : dx);
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s || s.id !== e.pointerId || !s.horizontal || blockRef?.current) {
      setDragX(0);
      return;
    }
    const dx = e.clientX - s.x;
    // RTL: السحب نحو اليمين يكشف الصفحة التالية (الموجودة يسارًا)
    if (dx > SWIPE_THRESHOLD) setPage((p) => Math.min(pages - 1, p + 1));
    else if (dx < -SWIPE_THRESHOLD) setPage((p) => Math.max(0, p - 1));
    setDragX(0);
  };

  return (
    <div className={`hand ${pages > 1 ? `has-more on-page-${page}` : ''}`} aria-label="يد القدرات">
      <div
        className="hand-viewport"
        data-testid="hand-viewport"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onClickCapture={(e) => {
          if (suppressClick.current) {
            e.stopPropagation();
            e.preventDefault();
            suppressClick.current = false;
          }
        }}
      >
        <div className={`hand-track ${dragX ? 'dragging' : ''}`} data-page={page} style={{ transform: `translateX(calc(${page * 100}% + ${dragX}px))` }}>
          {groups.map((g, i) => (
            <div
              className="hand-page"
              key={i}
              data-hand-page={i}
              onFocusCapture={() => {
                if (i !== page) setPage(i);
              }}
            >
              {g.map((id) => (
                <div className="hand-slot" key={id}>
                  {render(id)}
                </div>
              ))}
              {Array.from({ length: CARDS_PER_PAGE - g.length }, (_, k) => (
                <div className="hand-slot vacant" key={`e${k}`} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
