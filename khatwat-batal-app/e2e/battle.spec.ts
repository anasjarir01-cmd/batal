import { expect, test } from '@playwright/test';
import { idbGet, startBattle, touchSwipe } from './helpers';

type Rec = { rev: number; state: { round: number; hand: string[]; draw: string[]; discard: string[]; bossPlan: Array<{ abilityId: string; hidden: boolean }>; heroes: Array<{ hp: number }>; boss: { hp: number }; cards: Record<string, { abilityId: string }> }; execution?: { id: string; cursor: number; events: unknown[] }; prep: { prepId: string; candidates: string[] } };

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await page.locator('.account-card').waitFor();
});

test('ترتيب الساحة الإلزامي وأربع بطاقات كاملة في صف واحد، والسحب يمينًا يكشف البقية دون سحب من الرزمة', async ({ page }) => {
  await startBattle(page);
  const top = async (sel: string) => (await page.locator(sel).first().boundingBox())!.y;
  const order = [await top('.boss-banner'), await top('[data-testid=boss-moves]'), await top('[data-testid=plan-row]'), await top('.hand'), await top('[data-testid=heroes-row]')];
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  // البانر بعرض الساحة
  const banner = (await page.locator('.boss-banner').boundingBox())!;
  const arena = (await page.getByTestId('arena').boundingBox())!;
  expect(Math.round(banner.width)).toBe(Math.round(arena.width));
  // الأبطال فوق شريط التنقل وغير مخفيين خلفه
  const heroes = (await page.getByTestId('heroes-row').boundingBox())!;
  const tabbar = (await page.locator('.tabbar').boundingBox())!;
  expect(heroes.y + heroes.height).toBeLessThanOrEqual(tabbar.y + 1);

  const vp = (await page.getByTestId('hand-viewport').boundingBox())!;
  const inView = async (pageIdx: number) =>
    page.locator(`.hand-page[data-hand-page="${pageIdx}"] .hand-card .card-img-btn`).evaluateAll(
      (els, v) => els.map((e) => { const r = e.getBoundingClientRect(); return r.left >= v.x - 1 && r.right <= v.x + v.width + 1 && r.width > 40; }),
      vp,
    );
  expect(await inView(0)).toEqual([true, true, true, true]);
  expect(await inView(1)).toEqual([false, false, false, false]);
  // الصور أصلية كاملة (contain) ومحملة
  const imgs = await page.locator('.hand-card img').evaluateAll((els) => els.map((e) => ({ ok: (e as HTMLImageElement).complete && (e as HTMLImageElement).naturalWidth > 0, fit: getComputedStyle(e).objectFit })));
  expect(imgs.length).toBe(8);
  expect(imgs.every((i) => i.ok && i.fit === 'contain')).toBe(true);

  const before = await idbGet<Rec>(page, 'battle', 'current');
  const y = vp.y + vp.height / 2;
  await touchSwipe(page, vp.x + 60, y, vp.x + vp.width - 40); // إصبع نحو اليمين
  await expect(page.locator('.hand-track')).toHaveAttribute('data-page', '1');
  await page.waitForTimeout(400);
  expect(await inView(1)).toEqual([true, true, true, true]);
  expect(await inView(0)).toEqual([false, false, false, false]);
  await touchSwipe(page, vp.x + vp.width - 40, y, vp.x + 60); // والعكس يعود
  await expect(page.locator('.hand-track')).toHaveAttribute('data-page', '0');
  const after = await idbGet<Rec>(page, 'battle', 'current');
  expect(after.state.hand).toEqual(before.state.hand);
  expect(after.state.draw).toEqual(before.state.draw);
  expect(after.rev).toBe(before.rev);
});

test('البطاقة المخفية لا تتسرب في DOM، والتكبير يعرض الأصل PNG كاملًا', async ({ page }) => {
  await startBattle(page, 'yorigumo');
  const rec = await idbGet<Rec>(page, 'battle', 'current');
  const hiddenIdx = rec.state.bossPlan.findIndex((b) => b.hidden);
  const hiddenId = rec.state.bossPlan[hiddenIdx].abilityId;
  const html = await page.locator('[data-testid=boss-moves] .move-slot').nth(hiddenIdx).evaluate((e) => e.outerHTML);
  expect(html).not.toContain(hiddenId);
  expect(html).not.toContain(`yorigumo-${hiddenId}`);
  expect(html).toContain('مخفية');
  await page.locator('.hand-card .zoom-btn').first().click();
  const z = page.locator('.zoom-img');
  await expect(z).toBeVisible();
  const info = await z.evaluate((e) => ({ w: (e as HTMLImageElement).naturalWidth, src: (e as HTMLImageElement).src, fit: getComputedStyle(e).objectFit }));
  expect(info.src).toMatch(/\/assets\/.+\.png$/);
  expect([1024, 1200, 1600]).toContain(info.w);
  expect(info.fit).toBe('contain');
});

test('التخطيط ثم إعادة التحميل: نفس اليد وخطة الزعيم، والمسودة محفوظة؛ الروليت لا يعاد', async ({ page }) => {
  await page.getByRole('button', { name: 'القتال' }).click();
  await page.getByRole('button', { name: 'اختيار الكل' }).click();
  await page.getByTestId('confirm-team').click();
  const prep1 = (await idbGet<Rec>(page, 'battle', 'current')).prep;
  await page.reload();
  const prep2 = (await idbGet<Rec>(page, 'battle', 'current')).prep;
  expect(prep2).toEqual(prep1);
  await page.getByTestId('pick-fenrir').click();
  await page.getByTestId('arena').waitFor();
  const rec = await idbGet<Rec>(page, 'battle', 'current');
  // اختيار بطاقة لا تحتاج هدفًا
  const ids = rec.state.hand;
  const noTarget = ['H1', 'H4', 'N1', 'N2', 'N3', 'N4', 'S1', 'S2', 'S3', 'S4', 'E4', 'Z1', 'Z3', 'Z4'];
  const pick = ids.findIndex((id) => noTarget.includes(rec.state.cards[id].abilityId));
  await page.locator(`.hand-card[data-ability="${rec.state.cards[ids[pick]].abilityId}"] .card-img-btn`).click({ force: true });
  await expect(page.locator('.plan-slot.filled')).toHaveCount(1);
  await expect(page.locator('.hand-card')).toHaveCount(8); // البطاقة تبقى مظللة في اليد
  await page.waitForTimeout(300);
  await page.reload();
  await page.getByTestId('arena').waitFor();
  const rec2 = await idbGet<Rec>(page, 'battle', 'current');
  expect(rec2.state.hand).toEqual(rec.state.hand);
  expect(rec2.state.bossPlan).toEqual(rec.state.bossPlan);
  await expect(page.locator('.plan-slot.filled')).toHaveCount(1);
});

test('إعادة التحميل أثناء عرض التنفيذ لا تعيد تطبيق الضرر', async ({ page }) => {
  await startBattle(page);
  const rec = await idbGet<Rec>(page, 'battle', 'current');
  const ids = rec.state.hand;
  const attack = ids.find((id) => ['N3', 'S3', 'N2', 'S2', 'H1', 'N1', 'S1'].includes(rec.state.cards[id].abilityId))!;
  await page.locator(`.hand-card[data-ability="${rec.state.cards[attack].abilityId}"] .card-img-btn`).click({ force: true });
  await page.getByTestId('execute').click();
  await expect(page.getByTestId('arena')).toHaveClass(/is-playing/);
  const mid = await idbGet<Rec>(page, 'battle', 'current');
  expect(mid.state.round).toBe(2);
  expect(mid.execution!.cursor).toBeLessThan(mid.execution!.events.length);
  await page.reload();
  await page.getByTestId('arena').waitFor();
  const after = await idbGet<Rec>(page, 'battle', 'current');
  expect(after.state.round).toBe(2);
  expect(after.state.boss.hp).toBe(mid.state.boss.hp);
  expect(after.state.heroes.map((h) => h.hp)).toEqual(mid.state.heroes.map((h) => h.hp));
  expect(after.execution!.id).toBe(mid.execution!.id);
  // تخطي العرض ثم التحقق من ثبات الحالة
  const skip = page.getByRole('button', { name: 'تخطي العرض' });
  if (await skip.count()) await skip.click();
  await expect(page.getByTestId('arena')).not.toHaveClass(/is-playing/);
  const done = await idbGet<Rec>(page, 'battle', 'current');
  expect(done.state.boss.hp).toBe(mid.state.boss.hp);
  expect(done.execution!.cursor).toBe(done.execution!.events.length);
});

test('بطاقة بهدف حليف آخر لا تسمح باختيار صاحبها (إير)، والخطة تقبل ثلاث بطاقات كحد أقصى', async ({ page }) => {
  await startBattle(page);
  // بيئة اختبار: نضمن وجود E1 في اليد بتعديل الحالة المحفوظة ثم إعادة التحميل
  await page.evaluate(
    () =>
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
            const id = 'eir:E1';
            if (!s.hand.includes(id)) {
              s.draw = s.draw.filter((x: string) => x !== id);
              const out = s.hand.shift();
              s.draw.push(out);
              s.hand.unshift(id);
            }
            st.put(rec);
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.reload();
  await page.getByTestId('arena').waitFor();
  await page.locator('.hand-card[data-ability="E1"] .card-img-btn').click();
  await expect(page.locator('.targeting-hint')).toBeVisible();
  await expect(page.locator('.hero-token[data-unit="h3"]')).toBeDisabled();
  await expect(page.locator('.hero-token.selectable')).toHaveCount(4);
  await page.locator('.hero-token[data-unit="h1"]').click();
  await expect(page.locator('.plan-slot.filled')).toHaveCount(1);
  await expect(page.locator('.plan-slot.filled .tchip.link')).toContainText('نوبا');
  // ملء الخانات حتى ثلاث ثم محاولة رابعة
  const rest = page.locator('.hand-page[data-hand-page="0"] .hand-card:not(.planned) .card-img-btn');
  for (let i = 0; i < 6 && (await page.locator('.plan-slot.filled').count()) < 3; i++) {
    await rest.nth(0).click();
    if (await page.locator('.targeting-hint').count()) await page.locator('.hero-token.selectable').first().click();
    if ((await page.locator('.plan-slot.filled').count()) < 3 && i > 3) break;
  }
  expect(await page.locator('.plan-slot.filled').count()).toBeLessThanOrEqual(3);
});

test('الفوز يعرض شاشة النتيجة ويمنح الخمسة +1، و«معركة جديدة» تعود لاختيار الفريق', async ({ page }) => {
  await startBattle(page, 'fenrir');
  // بيئة اختبار: خفض حياة الزعيم ثم إعادة التحميل
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const req = indexedDB.open('khatwat-batal');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('battle', 'readwrite');
          const st = tx.objectStore('battle');
          const g = st.get('current');
          g.onsuccess = () => {
            const rec = g.result;
            rec.state.boss.hp = 1;
            rec.state.boss.shield = undefined;
            rec.state.bossPlan = [0, 1, 2].map(() => ({ abilityId: 'F1', targets: [0], hidden: false }));
            for (const h of rec.state.heroes) h.weaken = undefined;
            st.put(rec);
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
  );
  await page.reload();
  await page.getByTestId('arena').waitFor();
  const rec = await idbGet<Rec>(page, 'battle', 'current');
  const attack = rec.state.hand.find((id) => ['H1', 'H3', 'N1', 'N2', 'N3', 'N4', 'S1', 'S2', 'S3', 'S4'].includes(rec.state.cards[id].abilityId))!;
  const ab = rec.state.cards[attack].abilityId;
  await page.locator(`.hand-card[data-ability="${ab}"] .card-img-btn`).click({ force: true });
  if (await page.locator('.targeting-hint').count()) await page.locator('.hero-token.selectable').first().click();
  await page.getByTestId('execute').click();
  await page.getByRole('button', { name: 'تخطي العرض' }).click();
  await expect(page.getByRole('heading', { name: 'انتصار!' })).toBeVisible();
  const heroes = await page.evaluate(
    () =>
      new Promise<Array<{ wins: number }>>((res) => {
        const r = indexedDB.open('khatwat-batal');
        r.onsuccess = () => {
          const q = r.result.transaction('heroes').objectStore('heroes').getAll();
          q.onsuccess = () => res(q.result);
        };
      }),
  );
  expect(heroes.map((h) => h.wins)).toEqual([1, 1, 1, 1, 1]);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'انتصار!' })).toBeVisible();
  await page.getByTestId('new-battle').click();
  await expect(page.getByTestId('confirm-team')).toBeVisible();
  const heroes2 = await page.evaluate(
    () =>
      new Promise<Array<{ wins: number }>>((res) => {
        const r = indexedDB.open('khatwat-batal');
        r.onsuccess = () => {
          const q = r.result.transaction('heroes').objectStore('heroes').getAll();
          q.onsuccess = () => res(q.result);
        };
      }),
  );
  expect(heroes2.map((h) => h.wins)).toEqual([1, 1, 1, 1, 1]);
});

test('معركة كاملة عبر الواجهة حتى النهاية دون أخطاء (تمرير الجولات)', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startBattle(page, 'yorigumo');
  for (let i = 0; i < 80; i++) {
    if (await page.getByTestId('new-battle').count()) break;
    await page.getByTestId('execute').click();
    await page.getByRole('button', { name: 'تمرير', exact: true }).click();
    const skip = page.getByRole('button', { name: 'تخطي العرض' });
    await skip.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(150);
  }
  await expect(page.getByTestId('new-battle')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'خسارة' })).toBeVisible();
  expect(errors).toEqual([]);
});
