import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { addChallenge, addReward, closeSheet, completeFirst, makeWav, openSettings, profile, setVisibility, startBattle } from './helpers';

test.describe.configure({ mode: 'serial' });

test('العمل دون إنترنت بعد إعادة تحميل فعلية: الصفحات، صور لم تُفتح، معركة جديدة، إكمال، شراء، موسيقى محلية', async ({ page, context }) => {
  test.setTimeout(240_000);
  await page.goto('./');
  await page.locator('.account-card').waitFor();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 });
  await openSettings(page, 'البيانات');
  await page.getByTestId('download-assets').click();
  await expect(page.getByText('جاهز بلا إنترنت')).toBeVisible({ timeout: 180_000 });
  await closeSheet(page);

  await context.setOffline(true);
  await page.reload();
  await page.locator('.account-card').waitFor();
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  // صور مستويات لم يفتحها المستخدم، وبطاقة أصلية
  const ok = await page.evaluate(async () => {
    const urls = [
      'assets-display/hayato-complete-pack/hayato-level-5.webp',
      'assets/hayato-complete-pack/hayato-level-5.png',
      'assets/nuba-complete-pack-gallery/nuba-level-4.png',
      'assets/yorigumo-complete-pack/yorigumo-Y9.png',
      'assets-display/fenrir-complete-pack/fenrir-F9.webp',
    ];
    const out: boolean[] = [];
    for (const u of urls) {
      const img = new Image();
      img.src = u;
      await img.decode().then(
        () => out.push(img.naturalWidth > 0),
        () => out.push(false),
      );
    }
    return out;
  });
  expect(ok).toEqual([true, true, true, true, true]);

  // إكمال مهمة وشراء جائزة دون شبكة
  await addChallenge(page, 'بلا شبكة', 'legendary', true);
  await completeFirst(page, 'بلا شبكة');
  await addReward(page, 'مكافأة', 30);
  await page.getByRole('button', { name: 'الجوائز' }).click();
  await page.locator('.reward-card', { hasText: 'مكافأة' }).getByRole('button', { name: 'شراء' }).click();
  await page.getByRole('button', { name: 'اشترِ' }).click();
  await expect.poll(async () => (await profile(page)).coins).toBe(170);

  // معركة جديدة بصور محملة
  await startBattle(page, 'yorigumo');
  await page.waitForTimeout(500);
  const imgs = await page.getByTestId('arena').locator('img').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).complete && (e as HTMLImageElement).naturalWidth > 0));
  expect(imgs.length).toBeGreaterThan(10);
  expect(imgs.every(Boolean)).toBe(true);

  // موسيقى محلية دون شبكة
  await openSettings(page, 'الموسيقى');
  await page.getByTestId('music-input').setInputFiles({ name: 'song.wav', mimeType: 'audio/wav', buffer: makeWav() });
  await expect(page.locator('.tracks li')).toHaveCount(1);
  await page.getByRole('button', { name: 'تشغيل', exact: true }).click();
  await expect(page.getByRole('button', { name: 'إيقاف مؤقت' })).toBeVisible();
  await closeSheet(page);
  await context.setOffline(false);
});

test('الموسيقى: تتوقف عند الإخفاء وتستأنف عند الرجوع، ولا تُعاد عند التنقل بين الصفحات، والإيقاف اليدوي يُحترم', async ({ page }) => {
  await page.goto('./');
  await page.locator('.account-card').waitFor();
  await openSettings(page, 'الموسيقى');
  await page.getByTestId('music-input').setInputFiles([
    { name: 'a.wav', mimeType: 'audio/wav', buffer: makeWav(20) },
    { name: 'b.wav', mimeType: 'audio/wav', buffer: makeWav(8) },
  ]);
  await expect(page.locator('.tracks li')).toHaveCount(2);
  await page.getByRole('button', { name: 'تشغيل', exact: true }).click();
  await expect(page.getByRole('button', { name: 'إيقاف مؤقت' })).toBeVisible();
  await page.waitForTimeout(1500);
  await closeSheet(page);
  const musicBtn = page.getByRole('button', { name: 'إيقاف الموسيقى مؤقتًا' });
  await expect(musicBtn).toBeVisible();
  // التنقل بين الصفحات لا يعيد الأغنية
  for (const t of ['الجوائز', 'المجموعة', 'القتال', 'التحديات']) await page.getByRole('button', { name: t, exact: true }).click();
  await openSettings(page, 'الموسيقى');
  const time = await page.locator('.player-now .num').innerText();
  expect(time.startsWith('0:00')).toBe(false);
  await closeSheet(page);
  // الإخفاء يوقف مؤقتًا، والرجوع يستأنف
  await setVisibility(page, 'hidden');
  await expect(page.getByRole('button', { name: 'تشغيل الموسيقى' })).toBeVisible();
  await setVisibility(page, 'visible');
  await expect(page.getByRole('button', { name: 'إيقاف الموسيقى مؤقتًا' })).toBeVisible();
  // إيقاف يدوي ثم إخفاء/إظهار: لا استئناف تلقائي
  await page.getByRole('button', { name: 'إيقاف الموسيقى مؤقتًا' }).click();
  await setVisibility(page, 'hidden');
  await setVisibility(page, 'visible');
  await page.waitForTimeout(500);
  await expect(page.getByRole('button', { name: 'تشغيل الموسيقى' })).toBeVisible();
});

test('النسخ الاحتياطي: تصدير → بيئة جديدة فارغة → استيراد يعيد الصورة والأغنية والتقدم والمعركة؛ والملف غير الصالح يُرفض دون تخريب', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await page.goto('./');
  await page.locator('.account-card').waitFor();
  await addChallenge(page, 'مع صورة', 'hard', false, true);
  await completeFirst(page, 'مع صورة');
  await openSettings(page, 'الموسيقى');
  await page.getByTestId('music-input').setInputFiles({ name: 'song.wav', mimeType: 'audio/wav', buffer: makeWav(4) });
  await expect(page.locator('.tracks li')).toHaveCount(1);
  await closeSheet(page);
  await startBattle(page, 'fenrir');
  await page.getByTestId('execute').click();
  await page.getByRole('button', { name: 'تمرير', exact: true }).click();
  await page.getByRole('button', { name: 'تخطي العرض' }).click();
  await expect(page.getByTestId('arena')).not.toHaveClass(/is-playing/);
  const before = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('khatwat-batal');
    r.onsuccess = () => {
      const q = r.result.transaction('battle').objectStore('battle').get('current');
      q.onsuccess = () => res(q.result.state.round);
    };
  }));
  expect(before).toBe(2);
  await openSettings(page, 'البيانات');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'تصدير نسخة' }).click()]);
  const file = await download.path();
  const bytes = await readFile(file!);
  expect(bytes.length).toBeGreaterThan(1000);

  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar' });
  const p2 = await ctx2.newPage();
  await p2.goto('./');
  await p2.locator('.account-card').waitFor();
  expect(await profile(p2)).toMatchObject({ xp: 0, coins: 0 });
  // ملف غير صالح أولًا
  await openSettings(p2, 'البيانات');
  await p2.getByTestId('backup-input').setInputFiles({ name: 'bad.zip', mimeType: 'application/zip', buffer: Buffer.from('not a zip at all') });
  await expect(p2.locator('.toast-error')).toBeVisible();
  expect(await profile(p2)).toMatchObject({ xp: 0, coins: 0 });
  // الملف الصالح
  await p2.getByTestId('backup-input').setInputFiles({ name: download.suggestedFilename(), mimeType: 'application/zip', buffer: bytes });
  await p2.getByRole('button', { name: 'استبدال' }).click();
  await expect(p2.getByText('تم استرجاع النسخة الاحتياطية')).toBeVisible();
  expect(await profile(p2)).toMatchObject({ xp: 80, coins: 16 });
  await closeSheet(p2);
  await expect(p2.locator('.challenge', { hasText: 'مع صورة' }).locator('img.challenge-img')).toBeVisible();
  await openSettings(p2, 'الموسيقى');
  await expect(p2.locator('.tracks li')).toHaveCount(1);
  await closeSheet(p2);
  await p2.getByRole('button', { name: 'القتال' }).click();
  await p2.getByTestId('arena').waitFor();
  await expect(p2.locator('.round-badge')).toContainText('2');
  await ctx2.close();
});
