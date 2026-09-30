// نظام بسيط لنوافذ التأكيد والتنبيهات القصيرة.
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';

interface ConfirmReq {
  id: number;
  title: string;
  body?: ReactNode;
  confirmText: string;
  cancelText: string;
  tone: 'primary' | 'danger';
  resolve: (ok: boolean) => void;
}
interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
}

let confirms: ConfirmReq[] = [];
let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let snapshot = { confirms, toasts };
const update = () => {
  snapshot = { confirms, toasts };
  emit();
};

export function confirmDialog(opts: { title: string; body?: ReactNode; confirmText?: string; cancelText?: string; tone?: 'primary' | 'danger' }): Promise<boolean> {
  return new Promise((resolve) => {
    confirms = [...confirms, { id: ++seq, title: opts.title, body: opts.body, confirmText: opts.confirmText ?? 'تأكيد', cancelText: opts.cancelText ?? 'إلغاء', tone: opts.tone ?? 'primary', resolve }];
    update();
  });
}

export function toast(text: string, kind: Toast['kind'] = 'info') {
  const t = { id: ++seq, text, kind };
  toasts = [...toasts, t];
  update();
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    update();
  }, kind === 'error' ? 5000 : 3200);
}

function useDialogs() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
}

function ConfirmBox({ req }: { req: ConfirmReq }) {
  const done = useRef(false);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => btn.current?.focus(), []);
  const close = (ok: boolean) => {
    if (done.current) return; // منع النقر المزدوج
    done.current = true;
    confirms = confirms.filter((c) => c.id !== req.id);
    update();
    req.resolve(ok);
  };
  return (
    <div className="modal-backdrop" role="presentation" onClick={() => close(false)}>
      <div className="modal confirm" role="alertdialog" aria-modal="true" aria-labelledby={`cf-${req.id}`} onClick={(e) => e.stopPropagation()}>
        <h2 id={`cf-${req.id}`}>{req.title}</h2>
        {req.body ? <div className="modal-body">{req.body}</div> : null}
        <div className="modal-actions">
          <button ref={btn} className={`btn ${req.tone === 'danger' ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)}>
            {req.confirmText}
          </button>
          <button className="btn btn-ghost" onClick={() => close(false)}>
            {req.cancelText}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DialogHost() {
  const { confirms: cs, toasts: ts } = useDialogs();
  return (
    <>
      {cs.slice(0, 1).map((c) => (
        <ConfirmBox key={c.id} req={c} />
      ))}
      <div className="toasts" aria-live="polite">
        {ts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}
