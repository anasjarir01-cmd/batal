import { useEffect, useState, type ReactNode } from 'react';
import { blobUrlFor, cachedBlobUrl } from '../../store/appStore';
import { Icon } from './Icon';

/** رقم معزول الاتجاه داخل نص عربي. */
export function Num({ children }: { children: ReactNode }) {
  return <bdi className="num">{children}</bdi>;
}

export function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

/** يعزل نصًا لاتينيًا/رقميًا داخل جملة عربية عادية (مثل التنبيهات) حتى لا تنقلب الإشارات. */
export function iso(s: string | number): string {
  return `\u2066${s}\u2069`;
}

export function Bar({ value, max, tone = 'xp', label }: { value: number; max: number; tone?: string; label?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={`bar bar-${tone}`} role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <div className="bar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Coins({ n }: { n: number }) {
  return (
    <span className="money coins" title="Coins">
      <Icon name="coin" size={16} />
      <Num>{fmt(n)}</Num>
    </span>
  );
}

export function Gems({ n }: { n: number }) {
  return (
    <span className="money gems" title="جواهر الأبطال">
      <Icon name="gem" size={16} />
      <Num>{fmt(n)}</Num>
    </span>
  );
}

export function Xp({ n }: { n: number }) {
  return (
    <span className="money xp">
      <Icon name="star" size={16} />
      <Num>{fmt(n)}</Num> XP
    </span>
  );
}

/** صورة من وسائط المستخدم المحلية (IndexedDB). */
export function BlobImg({ id, alt, className, fallback = 'image' }: { id: string | null | undefined; alt: string; className?: string; fallback?: string }) {
  const [url, setUrl] = useState<string | null>(() => cachedBlobUrl(id));
  useEffect(() => {
    let live = true;
    setUrl(cachedBlobUrl(id));
    void blobUrlFor(id).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [id]);
  if (!url)
    return (
      <div className={`${className ?? ''} img-placeholder`} aria-label={alt}>
        <Icon name={fallback} size={34} />
      </div>
    );
  return <img className={className} src={url} alt={alt} draggable={false} />;
}

export function Sheet({ title, onClose, children, wide, className }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; className?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <section className={`sheet ${wide ? 'sheet-wide' : ''} ${className ?? ''}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="إغلاق">
            <Icon name="close" />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </section>
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={40} />
      </div>
      <h3>{title}</h3>
      {text ? <p>{text}</p> : null}
      {action}
    </div>
  );
}

/** يحول ملفًا من الهاتف إلى ArrayBuffer للتخزين المحلي. */
export async function readFile(file: File): Promise<{ data: ArrayBuffer; type: string; name: string }> {
  return { data: await file.arrayBuffer(), type: file.type || 'application/octet-stream', name: file.name };
}
