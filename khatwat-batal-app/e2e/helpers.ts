import type { Page } from '@playwright/test';

export const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

/** ملف WAV صغير (موجة جيبية) لاختبار الموسيقى المحلية. */
export function makeWav(seconds = 12, rate = 8000): Buffer {
  const n = seconds * rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 3000), 44 + i * 2);
  return buf;
}

/** قراءة سجل من IndexedDB الخاص بالتطبيق داخل الصفحة. */
export function idbGet<T = unknown>(page: Page, store: string, key: string): Promise<T> {
  return page.evaluate(
    ([s, k]) =>
      new Promise<T>((resolve, reject) => {
        const req = indexedDB.open('khatwat-batal');
        req.onsuccess = () => {
          const db = req.result;
          const q = db.transaction(s).objectStore(s).get(k);
          q.onsuccess = () => {
            resolve(q.result as T);
            db.close();
          };
          q.onerror = () => reject(q.error);
        };
        req.onerror = () => reject(req.error);
      }),
    [store, key] as const,
  );
}

export async function profile(page: Page) {
  return idbGet<{ xp: number; coins: number; gems: number }>(page, 'profile', 'main');
}

export async function setVisibility(page: Page, state: 'hidden' | 'visible') {
  await page.evaluate((st) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => st });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => st === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

export async function openSettings(page: Page, section: string) {
  await page.getByRole('button', { name: 'الإعدادات' }).click();
  await page.getByRole('tab', { name: section }).click();
}

export async function closeSheet(page: Page) {
  await page.getByRole('button', { name: 'إغلاق' }).first().click();
}

export async function addChallenge(page: Page, name: string, difficulty: string, once = false, withImage = false) {
  await openSettings(page, 'التحديات');
  await page.getByRole('button', { name: 'تحدٍّ جديد' }).click();
  await page.getByPlaceholder('مثال: قراءة 10 صفحات').fill(name);
  if (withImage) {
    await page.getByTestId('challenge-image-input').setInputFiles({ name: 'c.png', mimeType: 'image/png', buffer: PNG_1PX });
    await page.locator('.picker-preview').and(page.locator('img')).waitFor();
  }
  await page.locator('.editor select').selectOption(difficulty);
  if (once) await page.getByLabel('مرة واحدة').check();
  await page.getByRole('button', { name: 'حفظ' }).click();
  await page.getByRole('button', { name: 'تحدٍّ جديد' }).waitFor();
  await closeSheet(page);
}

export async function addReward(page: Page, name: string, price: number, once = false) {
  await openSettings(page, 'الجوائز');
  await page.getByRole('button', { name: 'جائزة جديدة' }).click();
  await page.getByPlaceholder('مثال: فيلم في السينما').fill(name);
  await page.locator('.editor input[inputmode=numeric]').fill(String(price));
  if (once) await page.getByLabel('مرة واحدة').check();
  await page.getByRole('button', { name: 'حفظ' }).click();
  await page.getByRole('button', { name: 'جائزة جديدة' }).waitFor();
  await closeSheet(page);
}

export async function completeFirst(page: Page, name: string) {
  const card = page.locator('.challenge', { hasText: name });
  await card.getByRole('button', { name: 'كمّلت' }).click();
  await page.getByRole('button', { name: 'نعم، كمّلت' }).click();
  await card.locator('.done-badge').or(page.locator('.done-list')).first().waitFor();
}

export async function startBattle(page: Page, boss: 'fenrir' | 'yorigumo' = 'fenrir') {
  await page.getByRole('button', { name: 'القتال' }).click();
  await page.getByRole('button', { name: 'اختيار الكل' }).click();
  await page.getByTestId('confirm-team').click();
  await page.getByTestId(`pick-${boss}`).click({ timeout: 10_000 });
  await page.getByTestId('arena').waitFor();
}

/** سحب لمسي حقيقي عبر CDP (touchStart/Move/End). */
export async function touchSwipe(page: Page, x1: number, y: number, x2: number) {
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y }] });
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + ((x2 - x1) * i) / steps, y }] });
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
}

/** بيئة اختبار: وضع بطاقات محددة أول اليد (بتعديل الحالة المحفوظة) ثم إعادة التحميل. */
export async function putCardsFirst(page: Page, cardIds: string[]) {
  await page.evaluate(
    (ids) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('khatwat-batal');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('battle', 'readwrite');
          const st = tx.objectStore('battle');
          const g = st.get('current');
          g.onsuccess = () => {
            const rec = g.result;
            const s = rec.state;
            const pool = [...s.hand, ...s.draw].filter((x: string) => !ids.includes(x));
            const size = s.hand.length;
            s.hand = [...ids, ...pool.slice(0, size - ids.length)];
            s.draw = [...pool.slice(size - ids.length), ...s.draw.filter((x: string) => !pool.includes(x) && !ids.includes(x))];
            s.discard = s.discard.filter((x: string) => !ids.includes(x));
            st.put(rec);
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    cardIds,
  );
  await page.reload();
  await page.getByTestId('arena').waitFor();
}

export async function openArenaMenu(page: Page) {
  await page.getByTestId('arena-menu-btn').click();
  await page.getByRole('dialog', { name: 'قائمة المعركة' }).waitFor();
}

/** تمرير الجولة من قائمة الترس مع التأكيد، ثم تخطي العرض إن ظهر. */
export async function passRound(page: Page) {
  await openArenaMenu(page);
  await page.getByRole('button', { name: 'تمرير الجولة' }).click();
  await page.getByRole('button', { name: 'تمرير', exact: true }).click();
  await page.getByRole('button', { name: 'تخطي العرض' }).click({ timeout: 5000 }).catch(() => undefined);
}

/** الخروج من الساحة إلى صفحات التطبيق (المعركة تبقى محفوظة). */
export async function leaveArena(page: Page) {
  await openArenaMenu(page);
  await page.getByRole('button', { name: 'العودة إلى صفحات التطبيق' }).click();
  await page.locator('.tabbar').waitFor();
}

type Pt = { x: number; y: number };
async function centerOf(page: Page, target: string | Pt): Promise<Pt> {
  if (typeof target !== 'string') return target;
  const b = await page.locator(target).first().boundingBox();
  if (!b) throw new Error(`لا يوجد عنصر: ${target}`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/**
 * سحب وإفلات باللمس الحقيقي عبر CDP: إصبع يلمس، يُمسك قليلًا، يتحرك نحو الهدف، ثم يُرفع.
 * hold = 0 يعني تحريكًا فوريًا بلا إمساك (كالتصفح).
 */
export async function touchDrag(page: Page, from: string | Pt, to: string | Pt, opts: { hold?: number; steps?: number } = {}) {
  const a = await centerOf(page, from);
  const b = await centerOf(page, to);
  const client = await page.context().newCDPSession(page);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', p?: Pt) => client.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] });
  await send('touchStart', a);
  await page.waitForTimeout(opts.hold ?? 380);
  const steps = opts.steps ?? 12;
  for (let i = 1; i <= steps; i++) {
    await send('touchMove', { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps });
    await page.waitForTimeout(16);
  }
  await send('touchEnd');
  await client.detach();
  await page.waitForTimeout(300);
}

/** نقل بطاقة من اليد إلى خانة الخطة k (1..3) بالسحب باللمس. */
export async function dragToSlot(page: Page, ability: string, slot: number) {
  await touchDrag(page, `.hand-card[data-ability="${ability}"] .card-img-btn`, `.pslot[data-slot="${slot}"]`);
}
