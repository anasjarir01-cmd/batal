// تسجيل Service Worker وإدارة التحديث في وقت آمن (لا نقطع معركة أثناء عرض التنفيذ).
import { useSyncExternalStore } from 'react';

interface PwaState {
  updateReady: boolean;
  swActive: boolean;
}

let state: PwaState = { updateReady: false, swActive: false };
const listeners = new Set<() => void>();
let updater: ((reload?: boolean) => Promise<void>) | null = null;

function set(p: Partial<PwaState>) {
  state = { ...state, ...p };
  for (const l of listeners) l();
}

export async function registerPwa() {
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) return;
  try {
    const { registerSW } = await import('virtual:pwa-register');
    updater = registerSW({
      immediate: true,
      onNeedRefresh() {
        set({ updateReady: true });
      },
      onOfflineReady() {
        set({ swActive: true });
      },
      onRegisteredSW(_url, reg) {
        if (reg?.active) set({ swActive: true });
        // فحص دوري خفيف للتحديث عند توفر الشبكة
        if (reg) setInterval(() => void reg.update().catch(() => undefined), 60 * 60 * 1000);
      },
    });
  } catch {
    /* بيئة بلا Service Worker */
  }
}

export async function applyUpdate() {
  await updater?.(true);
}

export function usePwa(): PwaState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
