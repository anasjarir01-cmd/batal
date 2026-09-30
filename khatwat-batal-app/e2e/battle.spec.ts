import { expect, test, type Page } from '@playwright/test';
import { idbGet, leaveArena, openArenaMenu, passRound, putCardsFirst, startBattle, touchSwipe } from './helpers';

type Rec = {
  rev: number;
  state: {
    round: number;
    hand: string[];
    draw: string[];
    discard: string[];
    outcome?: string;
    bossPlan: Array<{ abilityId: string; hidden: boolean; targets: number[] }>;
    heroes: Array<{ hp: number; heroId: string }>;
    boss: { hp: number };
    cards: Record<string, { abilityId: string }>;
  };
  execution?: { id: string; cursor: number; events: unknown[] };
  prep: { prepId: string; candidates: string[] };
};
type Draft = { key: string; plan: Array<{ cardId: string; target?: number }> };

const draft = async (page: Page) => (await idbGet<{ value: Draft }>(page, 'meta', 'battleDraft'))?.value;
const energy = (page: Page) => page.getByTestId('energy');
const filled = (page: Page) => page.locator('.pslot.filled');
const handBtn = (page: Page, ability: string) => page.locator(`.hand-card[data-ability="${ability}"] .card-img-btn`);

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await page.locator('.account-card').waitFor();
});

test('الساحة: البانر أولًا والترس يسارًا، بلا ترويسة أو شريط تنقل أو عناصر قديمة؛ تنفيذ يسارًا وطاقة يمينًا؛ ألوان الأدوار موحدة', async ({ page }) => {
  await startBattle(page);
  const arena = page.getByTestId('arena');
  // لا ترويسة ولا اسم تطبيق ولا شريط تنقل
  await expect(page.locator('.topbar')).toBeHidden();
  await expect(page.locator('.tabbar')).toBeHidden();
  await expect(arena.getByText('خطوة بطل')).toHaveCount(0);
  // البانر أول عنصر في الأعلى، والترس فوقه في الزاوية اليسرى
  const banner = (await page.locator('.boss-banner').boundingBox())!;
  expect(banner.y).toBeLessThanOrEqual(1);
  const gear = (await page.getByTestId('arena-menu-btn').boundingBox())!;
  expect(gear.x).toBeLessThan(banner.x + 30);
  expect(gear.y).toBeLessThan(banner.y + 40);
  // الترتيب الإلزامي
  const top = async (sel: string) => (await page.locator(sel).first().boundingBox())!.y;
  const order = [await top('.boss-banner'), await top('[data-testid=boss-moves]'), await top('[data-testid=plan-row]'), await top('.hand'), await top('[data-testid=heroes-row]')];
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  // الأبطال آخر عنصر ويظهرون كاملين في الشاشة بلا شريط تحتهم
  const heroes = (await page.getByTestId('heroes-row').boundingBox())!;
  const vh = page.viewportSize()!.height;
  expect(heroes.y + heroes.height).toBeLessThanOrEqual(vh + 1);
  // العناصر القديمة أزيلت كليًا
  for (const sel of ['.control-bar', '.hand-pager', '.pager-dots', '.pager-btn', '.zoom-btn', '.tchip', '.targeting-hint', '.slot-tools']) await expect(page.locator(sel)).toHaveCount(0);
  await expect(arena.getByText('المنفذة')).toHaveCount(0);
  await expect(arena.getByText('مخفية')).toHaveCount(0);
  await expect(arena.getByRole('button', { name: /تمرير الجولة/ })).toHaveCount(0);
  await expect(arena.getByRole('button', { name: 'انسحاب' })).toHaveCount(0);
  // أزرار التكبير الخاصة بقارئ الشاشة لا تشغل مساحة ظاهرة
  const zoomSizes = await page.locator('.sr-zoom').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  expect(zoomSizes.every((w) => w <= 1)).toBe(true);

  // صف الخطة فعليًا من اليسار: تنفيذ | 3 | 2 | 1 | طاقة
  const x = async (sel: string) => (await page.locator(sel).boundingBox())!.x;
  const xs = [await x('[data-testid=execute]'), await x('.pslot[data-slot="3"]'), await x('.pslot[data-slot="2"]'), await x('.pslot[data-slot="1"]'), await x('[data-testid=energy]')];
  expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  await expect(energy(page)).toContainText('7/7');
  await expect(page.getByTestId('execute')).toBeDisabled();
  await expect(page.getByTestId('execute')).toContainText('تنفيذ');
  // حركات الزعيم: 1 يمينًا ثم 2 ثم 3 يسارًا؛ والأبطال بخانات الأدوار من اليمين
  const bx = [await x('.bmove[data-slot="1"]'), await x('.bmove[data-slot="2"]'), await x('.bmove[data-slot="3"]')];
  expect(bx[0]).toBeGreaterThan(bx[1]);
  expect(bx[1]).toBeGreaterThan(bx[2]);
  const hx = await Promise.all([0, 1, 2, 3, 4].map((i) => x(`.hero-token[data-unit="h${i}"]`)));
  expect([...hx].sort((a, b) => b - a)).toEqual(hx);

  // لون الدور نفسه على البطل وشريط حياته وكل بطاقات قدراته في اليد
  const colors = await page.evaluate(() => {
    const rc = (el: Element) => getComputedStyle(el).getPropertyValue('--rc').trim();
    const byOwner: Record<string, string> = {};
    const tokens = [...document.querySelectorAll('.hero-token')].map((t) => ({ role: [...t.classList].find((c) => c.startsWith('role-')), c: rc(t), hp: rc(t.querySelector('.hp-fill')!) }));
    for (const h of document.querySelectorAll('.hand-card')) byOwner[h.getAttribute('data-ability')!] = rc(h);
    return { tokens, byOwner };
  });
  const roles = ['role-warrior', 'role-mage', 'role-assassin', 'role-healer', 'role-support'];
  expect(colors.tokens.map((t) => t.role)).toEqual(roles);
  expect(new Set(colors.tokens.map((t) => t.c)).size).toBe(5);
  for (const t of colors.tokens) expect(t.hp).toBe(t.c);
  const letterRole: Record<string, number> = { H: 0, N: 1, S: 2, E: 3, Z: 4 };
  for (const [ab, c] of Object.entries(colors.byOwner)) expect(c).toBe(colors.tokens[letterRole[ab[0]]].c);

  // الصور الأصلية كاملة (contain) ومحملة؛ صورة البانر وحدها تملأ الإطار
  const imgs = await arena.locator('img:not(.bb-img):not(.slot-target img)').evaluateAll((els) => els.map((e) => ({ ok: (e as HTMLImageElement).complete && (e as HTMLImageElement).naturalWidth > 0, fit: getComputedStyle(e).objectFit })));
  expect(imgs.length).toBeGreaterThanOrEqual(8 + 5 + 2);
  expect(imgs.every((i) => i.ok && i.fit === 'contain')).toBe(true);
  // بلا تمرير أفقي للصفحة
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('اليد: أربع بطاقات كاملة، والسحب يمينًا يكشف الأربع الأخرى دون اختيار أي بطاقة ودون السحب من الرزمة', async ({ page }) => {
  await startBattle(page);
  const vp = (await page.getByTestId('hand-viewport').boundingBox())!;
  const inView = async (pageIdx: number) =>
    page.locator(`.hand-page[data-hand-page="${pageIdx}"] .hand-card .card-img-btn`).evaluateAll(
      (els, v) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return r.left >= v.x - 1 && r.right <= v.x + v.width + 1 && r.width > 40;
        }),
      vp,
    );
  expect(await inView(0)).toEqual([true, true, true, true]);
  expect(await inView(1)).toEqual([false, false, false, false]);
  const before = await idbGet<Rec>(page, 'battle', 'current');
  const y = vp.y + vp.height / 2;
  await touchSwipe(page, vp.x + 60, y, vp.x + vp.width - 40); // إصبع نحو اليمين
  await expect(page.locator('.hand-track')).toHaveAttribute('data-page', '1');
  await page.waitForTimeout(450);
  expect(await inView(1)).toEqual([true, true, true, true]);
  expect(await inView(0)).toEqual([false, false, false, false]);
  await touchSwipe(page, vp.x + vp.width - 40, y, vp.x + 60); // والعكس يعود
  await expect(page.locator('.hand-track')).toHaveAttribute('data-page', '0');
  await page.waitForTimeout(450);
  // السحب لم يختر شيئًا ولم يستهلك طاقة
  await expect(filled(page)).toHaveCount(0);
  await expect(energy(page)).toContainText('7/7');
  await expect(page.locator('.hand-card.planned, .hand-card.pending')).toHaveCount(0);
  const after = await idbGet<Rec>(page, 'battle', 'current');
  expect(after.state.hand).toEqual(before.state.hand);
  expect(after.state.draw).toEqual(before.state.draw);
  expect(after.rev).toBe(before.rev);
});

test('لمسة تختار ولمستان تكبّران دون تغيير الخطة أو الطاقة؛ × يزيل ويعيد الطاقة', async ({ page }) => {
  await startBattle(page);
  await putCardsFirst(page, ['nuba:N2', 'skadi:S1', 'hayato:H1', 'nuba:N1']);
  // لمستان على بطاقة في اليد: تكبير فقط
  await handBtn(page, 'N2').dblclick();
  await expect(page.locator('.zoom-img')).toBeVisible();
  await page.getByRole('button', { name: 'إغلاق' }).first().click();
  await page.waitForTimeout(400);
  await expect(filled(page)).toHaveCount(0);
  await expect(energy(page)).toContainText('7/7');
  // لمسة واحدة: اختيار
  await handBtn(page, 'N2').click();
  await expect(filled(page)).toHaveCount(1);
  await expect(energy(page)).toContainText('5/7');
  await expect(page.getByTestId('execute')).toBeEnabled();
  // لمستان على البطاقة المخططة (في الخطة وفي اليد): تكبير، والخطة كما هي
  await page.locator('.pslot[data-slot="1"] .card-img-btn').dblclick();
  await expect(page.locator('.zoom-img')).toBeVisible();
  await page.getByRole('button', { name: 'إغلاق' }).first().click();
  await handBtn(page, 'N2').dblclick();
  await expect(page.locator('.zoom-img')).toBeVisible();
  await page.getByRole('button', { name: 'إغلاق' }).first().click();
  await page.waitForTimeout(400);
  await expect(filled(page)).toHaveCount(1);
  await expect(energy(page)).toContainText('5/7');
  await expect(page.locator('.pslot.selected')).toHaveCount(0);
  // لمستان على حركة زعيم ظاهرة: الأصل وأهدافها
  const rec = await idbGet<Rec>(page, 'battle', 'current');
  const vis = rec.state.bossPlan.findIndex((b) => !b.hidden);
  await page.locator(`.bmove[data-slot="${vis + 1}"] .card-img-btn`).dblclick();
  await expect(page.locator('.zoom-img')).toBeVisible();
  await expect(page.getByText('أهداف هذه الجولة')).toBeVisible();
  await page.getByRole('button', { name: 'إغلاق' }).first().click();
  // لمسة على حركة ظاهرة تعلّم أهدافها على الأبطال
  await page.locator(`.bmove[data-slot="${vis + 1}"] .card-img-btn`).click();
  const targets = rec.state.bossPlan[vis].targets;
  if (targets.length) await expect(page.locator('.hero-token.threat')).toHaveCount(targets.length);
  else await expect(page.locator('.boss-banner.self-target')).toHaveCount(1);
  await page.keyboard.press('Escape');
  // × يزيل ويعيد الطاقة، دون تكبير أو تنفيذ
  await page.getByRole('button', { name: /إزالة .* من الخانة 1/ }).click();
  await expect(filled(page)).toHaveCount(0);
  await expect(energy(page)).toContainText('7/7');
  await expect(page.locator('.zoom-img')).toHaveCount(0);
  const r2 = await idbGet<Rec>(page, 'battle', 'current');
  expect(r2.state.round).toBe(1);
  expect(r2.rev).toBe(rec.rev);
  // ثلاث بطاقات كحد أقصى وحساب الطاقة 7
  for (const a of ['S1', 'H1', 'N1']) await handBtn(page, a).click();
  await expect(filled(page)).toHaveCount(3);
  await expect(energy(page)).toContainText('4/7');
  await handBtn(page, 'N2').click();
  await expect(page.getByText('ثلاث بطاقات كحد أقصى')).toBeVisible();
  await expect(filled(page)).toHaveCount(3);
});

test('إعادة الترتيب بلمس خانتين، وتعديل الهدف بلمس الخانة ثم بطل؛ صاحب «إير» ممنوع هدفًا لنفسه', async ({ page }) => {
  await startBattle(page);
  await putCardsFirst(page, ['eir:E1', 'nuba:N1', 'skadi:S1', 'hayato:H1']);
  await handBtn(page, 'E1').click();
  await expect(page.locator('.pslot.ghost')).toHaveCount(1);
  await expect(page.locator('.mode-hint')).toContainText('اختر هدفًا');
  await expect(page.locator('.hero-token[data-unit="h3"]')).toBeDisabled();
  await expect(page.locator('.hero-token.selectable')).toHaveCount(4);
  await page.locator('.hero-token[data-unit="h1"]').click();
  await expect(filled(page)).toHaveCount(1);
  await expect(page.locator('.pslot[data-slot="1"] .slot-target')).toHaveCount(1);
  await handBtn(page, 'N1').click();
  await expect(filled(page)).toHaveCount(2);
  await expect.poll(async () => (await draft(page))?.plan.map((p) => p.cardId)).toEqual(['eir:E1', 'nuba:N1']);
  // إعادة الترتيب: لمس الخانة 1 ثم الخانة 2
  await page.locator('.pslot[data-slot="1"] .card-img-btn').click();
  await expect(page.locator('.pslot[data-slot="1"]')).toHaveClass(/selected/);
  await expect(page.locator('.pslot[data-slot="2"]')).toHaveClass(/move-target/);
  await expect(page.locator('.hero-token.current')).toHaveCount(1);
  await page.locator('.pslot[data-slot="2"] .card-img-btn').click();
  await expect(page.locator('.pslot[data-slot="1"]')).toHaveAttribute('data-ability', 'N1');
  await expect(page.locator('.pslot[data-slot="2"]')).toHaveAttribute('data-ability', 'E1');
  await expect.poll(async () => (await draft(page))?.plan.map((p) => p.cardId)).toEqual(['nuba:N1', 'eir:E1']);
  // تعديل الهدف: لمس الخانة ثم بطل آخر مسموح
  await page.locator('.pslot[data-slot="2"] .card-img-btn').click();
  await expect(page.locator('.hero-token[data-unit="h1"]')).toHaveClass(/current/);
  await expect(page.locator('.hero-token[data-unit="h3"]')).not.toHaveClass(/selectable/);
  await page.locator('.hero-token[data-unit="h0"]').click();
  await expect.poll(async () => (await draft(page))?.plan[1]).toEqual({ cardId: 'eir:E1', target: 0 });
  await expect(energy(page)).toContainText('5/7');
  // التنفيذ يقفل الخطة: لا × أثناء العرض، والزر معطل ضد التكرار
  await page.getByTestId('execute').click();
  await expect(page.getByTestId('arena')).toHaveClass(/is-playing/);
  await expect(page.getByTestId('execute')).toBeDisabled();
  await expect(page.locator('.slot-x')).toHaveCount(0);
  const mid = await idbGet<Rec>(page, 'battle', 'current');
  expect(mid.state.round).toBe(2);
});

test('الحركة المخفية لا تتسرب: لا معرّف ولا صورة ولا هدف، وتكبيرها يعرض الظهر فقط', async ({ page }) => {
  await startBattle(page, 'yorigumo');
  const rec = await idbGet<Rec>(page, 'battle', 'current');
  const hiddenIdx = rec.state.bossPlan.findIndex((b) => b.hidden);
  const hiddenId = rec.state.bossPlan[hiddenIdx].abilityId;
  const card = page.locator(`.bmove[data-slot="${hiddenIdx + 1}"]`);
  const html = await card.evaluate((e) => e.outerHTML);
  expect(html).not.toContain(hiddenId);
  expect(html).not.toContain(`yorigumo-${hiddenId}`);
  await expect(card.locator('.card-back')).toContainText('؟');
  await expect(card).toHaveClass(/role-hidden/);
  // لمسة لا تكشف أهدافًا
  await card.locator('.card-img-btn').click();
  await page.waitForTimeout(400);
  await expect(page.locator('.hero-token.threat')).toHaveCount(0);
  // لمستان: الظهر فقط
  await card.locator('.card-img-btn').dblclick();
  const sheet = page.locator('.hidden-zoom');
  await expect(sheet).toBeVisible();
  const sh = await sheet.evaluate((e) => e.outerHTML);
  expect(sh).not.toContain(hiddenId);
  expect(sh).not.toContain('yorigumo-');
  await expect(page.locator('.zoom-img')).toHaveCount(0);
  await page.getByRole('button', { name: 'إغلاق' }).first().click();
  // تكبير بطاقة من اليد يعرض الأصل PNG كاملًا
  await page.locator('.hand-card .card-img-btn').first().dblclick();
  const z = page.locator('.zoom-img');
  await expect(z).toBeVisible();
  const info = await z.evaluate((e) => ({ w: (e as HTMLImageElement).naturalWidth, src: (e as HTMLImageElement).src, fit: getComputedStyle(e).objectFit }));
  expect(info.src).toMatch(/\/assets\/.+\.png$/);
  expect([1024, 1200, 1600]).toContain(info.w);
  expect(info.fit).toBe('contain');
});

test('قائمة الترس: فتحها وإغلاقها لا يمس الخطة؛ تمرير الجولة بتأكيد؛ الخروج ثم المتابعة؛ الانسحاب بتأكيد يعيد التنقل', async ({ page }) => {
  await startBattle(page);
  await putCardsFirst(page, ['nuba:N2', 'skadi:S1', 'hayato:H1', 'nuba:N1']);
  await handBtn(page, 'N2').click();
  await expect(filled(page)).toHaveCount(1);
  const rev0 = (await idbGet<Rec>(page, 'battle', 'current')).rev;
  await openArenaMenu(page);
  await page.getByRole('button', { name: 'إغلاق القائمة' }).click();
  await expect(filled(page)).toHaveCount(1);
  await expect(energy(page)).toContainText('5/7');
  expect((await idbGet<Rec>(page, 'battle', 'current')).rev).toBe(rev0);
  // إلغاء التمرير لا ينفذ شيئًا
  await openArenaMenu(page);
  await page.getByRole('button', { name: 'تمرير الجولة' }).click();
  await page.getByRole('button', { name: 'إلغاء' }).click();
  await expect(filled(page)).toHaveCount(1);
  expect((await idbGet<Rec>(page, 'battle', 'current')).state.round).toBe(1);
  // الخروج إلى التطبيق ثم المتابعة: المعركة والخطة محفوظتان
  await leaveArena(page);
  await expect(page.locator('.topbar')).toBeVisible();
  await page.locator('.resume-battle').click();
  await page.getByTestId('arena').waitFor();
  await expect(page.locator('.tabbar')).toBeHidden();
  await expect(filled(page)).toHaveCount(1);
  // التمرير بتأكيد: الجولة الثانية
  await passRound(page);
  await expect(page.getByTestId('arena')).not.toHaveClass(/is-playing/);
  await expect(page.locator('.round-badge')).toContainText('2');
  await expect(filled(page)).toHaveCount(0);
  // الانسحاب بتأكيد
  await openArenaMenu(page);
  await page.getByRole('button', { name: 'الانسحاب من المعركة' }).click();
  await page.getByRole('button', { name: 'انسحاب', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'انسحاب' })).toBeVisible();
  await expect(page.locator('.tabbar')).toBeVisible();
  expect((await idbGet<Rec>(page, 'battle', 'current')).state.outcome).toBe('retreat');
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
  await putCardsFirst(page, ['skadi:S2', 'hayato:H1', 'nuba:N1', 'skadi:S1']);
  const rec = await idbGet<Rec>(page, 'battle', 'current');
  await handBtn(page, 'S2').click();
  await expect(filled(page)).toHaveCount(1);
  await expect(page.locator('.hand-card')).toHaveCount(8); // البطاقة تبقى مظللة في اليد
  await page.waitForTimeout(300);
  await page.reload();
  await page.getByTestId('arena').waitFor();
  const rec2 = await idbGet<Rec>(page, 'battle', 'current');
  expect(rec2.state.hand).toEqual(rec.state.hand);
  expect(rec2.state.bossPlan).toEqual(rec.state.bossPlan);
  await expect(filled(page)).toHaveCount(1);
  await expect(energy(page)).toContainText('5/7');
});

test('إعادة التحميل أثناء عرض التنفيذ لا تعيد تطبيق الضرر', async ({ page }) => {
  await startBattle(page);
  await putCardsFirst(page, ['nuba:N3', 'hayato:H1', 'nuba:N1', 'skadi:S1']);
  await handBtn(page, 'N3').click();
  await expect(filled(page)).toHaveCount(1);
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
  const skip = page.getByRole('button', { name: 'تخطي العرض' });
  if (await skip.count()) await skip.click();
  await expect(page.getByTestId('arena')).not.toHaveClass(/is-playing/);
  const done = await idbGet<Rec>(page, 'battle', 'current');
  expect(done.state.boss.hp).toBe(mid.state.boss.hp);
  expect(done.execution!.cursor).toBe(done.execution!.events.length);
});

test('الفوز يعرض شاشة النتيجة ويمنح الخمسة +1، و«معركة جديدة» تعود لاختيار الفريق', async ({ page }) => {
  await startBattle(page, 'fenrir');
  // بيئة اختبار: خفض حياة الزعيم وتثبيت حركاته ثم إعادة التحميل
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
  await putCardsFirst(page, ['skadi:S2', 'hayato:H1', 'nuba:N1', 'skadi:S1']);
  await handBtn(page, 'S2').click();
  await expect(filled(page)).toHaveCount(1);
  await page.getByTestId('execute').click();
  await page.getByRole('button', { name: 'تخطي العرض' }).click();
  await expect(page.getByRole('heading', { name: 'انتصار!' })).toBeVisible();
  await expect(page.locator('.tabbar')).toBeVisible();
  const wins = () =>
    page.evaluate(
      () =>
        new Promise<number[]>((res) => {
          const r = indexedDB.open('khatwat-batal');
          r.onsuccess = () => {
            const q = r.result.transaction('heroes').objectStore('heroes').getAll();
            q.onsuccess = () => res(q.result.map((h: { wins: number }) => h.wins));
          };
        }),
    );
  expect(await wins()).toEqual([1, 1, 1, 1, 1]);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'انتصار!' })).toBeVisible();
  await page.getByTestId('new-battle').click();
  await expect(page.getByTestId('confirm-team')).toBeVisible();
  expect(await wins()).toEqual([1, 1, 1, 1, 1]);
});

test('معركة كاملة عبر الواجهة حتى النهاية دون أخطاء (تمرير الجولات من قائمة الترس)', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startBattle(page, 'yorigumo');
  for (let i = 0; i < 80; i++) {
    if (await page.getByTestId('new-battle').count()) break;
    await passRound(page);
    await page.waitForTimeout(150);
  }
  await expect(page.getByTestId('new-battle')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'خسارة' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('لوحة المفاتيح وقارئ الشاشة: Enter يختار، وزر التكبير المخفي يظهر عند التركيز ويكبّر، والتركيز على بطاقة بعيدة يقلب اليد', async ({ page }) => {
  await startBattle(page);
  await putCardsFirst(page, ['nuba:N2', 'skadi:S1', 'hayato:H1', 'nuba:N1']);
  await handBtn(page, 'N2').focus();
  await page.keyboard.press('Enter');
  await expect(filled(page)).toHaveCount(1);
  await page.keyboard.press('Tab');
  const zoom = page.locator('.hand-card[data-ability="N2"] .sr-zoom');
  await expect(zoom).toBeFocused();
  expect((await zoom.boundingBox())!.width).toBeGreaterThan(20);
  await page.keyboard.press('Enter');
  await expect(page.locator('.zoom-img')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.zoom-img')).toHaveCount(0);
  await expect(filled(page)).toHaveCount(1);
  await page.locator('.hand-page[data-hand-page="1"] .card-img-btn').first().focus();
  await expect(page.locator('.hand-track')).toHaveAttribute('data-page', '1');
});

test.describe('شاشة قصيرة 360×640', () => {
  test.use({ viewport: { width: 360, height: 640 } });
  test('كل الصفوف ظاهرة بلا تمرير أفقي، وأربع بطاقات كاملة في اليد', async ({ page }) => {
    await startBattle(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const heroes = (await page.getByTestId('heroes-row').boundingBox())!;
    const docH = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(heroes.y + heroes.height).toBeLessThanOrEqual(docH + 1);
    expect(docH).toBeLessThanOrEqual(640 + 40);
    const vp = (await page.getByTestId('hand-viewport').boundingBox())!;
    const visible = await page.locator('.hand-page[data-hand-page="0"] .hand-card .card-img-btn').evaluateAll(
      (els, v) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return r.left >= v.x - 1 && r.right <= v.x + v.width + 1;
        }),
      vp,
    );
    expect(visible).toEqual([true, true, true, true]);
    const xs = await Promise.all(['[data-testid=execute]', '.pslot[data-slot="3"]', '.pslot[data-slot="1"]', '[data-testid=energy]'].map(async (s) => (await page.locator(s).boundingBox())!.x));
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });
});
