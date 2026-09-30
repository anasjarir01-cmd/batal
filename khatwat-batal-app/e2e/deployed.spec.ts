// تحقق على الموقع المنشور فعليًا (يعمل فقط عند ضبط DEPLOYED_URL، مثل خطوة التحقق في workflow النشر):
// قابلية تثبيت PWA حسب Chrome نفسه، العمل دون إنترنت بعد إعادة تحميل فعلية، وتصدير النسخة الاحتياطية.
import { expect, test } from '@playwright/test';
import { closeSheet, openSettings } from './helpers';

const URL = process.env.DEPLOYED_URL;
test.skip(!URL, 'DEPLOYED_URL غير مضبوط');
test.describe.configure({ mode: 'serial' });

test('الموقع المنشور: قابل للتثبيت، يعمل دون إنترنت، والتصدير ينزّل ملف ZIP', async ({ page, context }) => {
  test.setTimeout(420_000);
  await page.goto(URL!);
  await page.locator('.account-card').waitFor({ timeout: 60_000 });
  const u = new globalThis.URL(page.url());
  expect(u.protocol === 'https:' || u.hostname === 'localhost').toBe(true);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60_000 });

  // 1) قابلية التثبيت كما يحكم بها Chrome
  const cdp = await context.newCDPSession(page);
  const inst = await cdp.send('Page.getInstallabilityErrors');
  const man = await cdp.send('Page.getAppManifest');
  console.log('manifest:', man.url, 'errors:', JSON.stringify(man.errors));
  console.log('installabilityErrors:', JSON.stringify(inst.installabilityErrors));
  expect(man.errors).toEqual([]);
  expect(inst.installabilityErrors).toEqual([]);

  // 2) تنزيل أصول اللعب ثم العمل دون إنترنت بعد إعادة تحميل فعلية
  await openSettings(page, 'البيانات');
  await page.getByTestId('download-assets').click();
  await expect(page.getByText('جاهز بلا إنترنت')).toBeVisible({ timeout: 300_000 });
  await closeSheet(page);
  await context.setOffline(true);
  await page.reload();
  await page.locator('.account-card').waitFor();
  const imgs = await page.evaluate(async () => {
    const out: boolean[] = [];
    for (const u of ['assets/hayato-complete-pack/hayato-level-5.png', 'assets-display/yorigumo-complete-pack/yorigumo-Y9.webp']) {
      const img = new Image();
      img.src = u;
      await img.decode().then(
        () => out.push(img.naturalWidth > 0),
        () => out.push(false),
      );
    }
    return out;
  });
  console.log('offline images:', JSON.stringify(imgs));
  expect(imgs).toEqual([true, true]);
  await page.getByRole('button', { name: 'القتال' }).click();
  await expect(page.getByTestId('confirm-team')).toBeVisible();

  // 3) تصدير النسخة الاحتياطية (دون إنترنت أيضًا)
  await openSettings(page, 'البيانات');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'تصدير نسخة' }).click()]);
  const path = await download.path();
  const fs = await import('node:fs/promises');
  const bytes = await fs.readFile(path!);
  console.log('backup:', download.suggestedFilename(), bytes.length, 'bytes');
  expect(bytes.subarray(0, 2).toString()).toBe('PK');
  expect(download.suggestedFilename()).toMatch(/^khatwat-batal-backup-.*\.zip$/);
  await context.setOffline(false);
});
