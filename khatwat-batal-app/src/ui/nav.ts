// التنقل: أربع صفحات رئيسية عبر hash، واللوحات الفرعية (إعدادات، سجل، متجر، تفاصيل) كطبقة واحدة.
import { useSyncExternalStore } from 'react';

export type Page = 'challenges' | 'rewards' | 'collection' | 'battle';
export const PAGES: Page[] = ['challenges', 'rewards', 'collection', 'battle'];

export type Overlay =
  | { kind: 'settings'; section?: 'challenges' | 'rewards' | 'music' | 'sound' | 'look' | 'data'; editId?: string | 'new' }
  | { kind: 'history'; filter?: string }
  | { kind: 'heroStore' }
  | { kind: 'hero'; heroId: string }
  | { kind: 'boss'; bossId: string }
  | { kind: 'card'; abilityId: string; cardId?: string; target?: number }
  | null;

interface NavState {
  page: Page;
  overlay: Overlay;
}

function pageFromHash(): Page {
  const h = location.hash.replace(/^#\/?/, '') as Page;
  return PAGES.includes(h) ? h : 'challenges';
}

let state: NavState = { page: typeof location !== 'undefined' ? pageFromHash() : 'challenges', overlay: null };
const listeners = new Set<() => void>();
const set = (p: Partial<NavState>) => {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
};

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => set({ page: pageFromHash() }));
}

export function goto(page: Page) {
  if (location.hash !== `#/${page}`) location.hash = `#/${page}`;
  set({ page });
}

export function openOverlay(o: Overlay) {
  set({ overlay: o });
}

export function closeOverlay() {
  set({ overlay: null });
}

export function useNav(): NavState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
