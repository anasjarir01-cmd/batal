import { expect, test } from '@playwright/test';
import { addChallenge, addReward, closeSheet, completeFirst, profile } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await page.locator('.account-card').waitFor();
});

test('أول تشغيل: أرصدة صفرية، خمسة أبطال، زعيمان مفتوحان، متجر أبطال فارغ، لا تحديات نموذجية', async ({ page }) => {
  expect(await profile(page)).toMatchObject({ xp: 0, coins: 0, gems: 0 });
  await expect(page.getByText('ما زال ما عندك حتى تحدي')).toBeVisible();
  await expect(page.getByText('المبتدئ')).toBeVisible();
  await page.getByRole('button', { name: 'المجموعة' }).click();
  await expect(page.locator('.hero-card')).toHaveCount(5);
  await page.getByRole('tab', { name: /Bosses/ }).click();
  await expect(page.locator('.boss-card')).toHaveCount(2);
  await expect(page.locator('.boss-card.locked')).toHaveCount(0);
  await page.getByRole('tab', { name: /الأبطال/ }).click();
  await page.getByRole('button', { name: 'متجر الأبطال' }).click();
  await expect(page.getByText('لا يوجد أبطال جدد حاليًا')).toBeVisible();
});

test('إكمال تحدٍّ: الإلغاء لا يغير شيئًا، والتأكيد المزدوج يصرف مرة واحدة، ويبقى مكتملًا بعد إعادة التحميل', async ({ page }) => {
  await addChallenge(page, 'قراءة', 'medium', false, true);
  const card = page.locator('.challenge', { hasText: 'قراءة' });
  await expect(card.locator('img.challenge-img')).toBeVisible();
  await card.getByRole('button', { name: 'كمّلت' }).click();
  await expect(page.getByText('واش متأكد بلي كملتي هاد التحدّي؟')).toBeVisible();
  await page.getByRole('button', { name: 'لا، رجوع' }).click();
  expect((await profile(page)).xp).toBe(0);
  await card.getByRole('button', { name: 'كمّلت' }).click();
  await page.getByRole('button', { name: 'نعم، كمّلت' }).dblclick();
  await expect(card.locator('.done-badge')).toBeVisible();
  expect(await profile(page)).toMatchObject({ xp: 40, coins: 8 });
  await page.reload();
  await expect(page.locator('.challenge', { hasText: 'قراءة' }).locator('.done-badge')).toBeVisible();
  expect(await profile(page)).toMatchObject({ xp: 40, coins: 8 });
});

test('الجوائز: رصيد ناقص يبيّن المقدار دون خصم، والشراء يخصم، والمرة الواحدة تختفي وتبقى بالسجل', async ({ page }) => {
  await addReward(page, 'سينما', 250);
  await addReward(page, 'كتاب', 50, true);
  await page.getByRole('button', { name: 'الجوائز' }).click();
  await page.locator('.reward-card', { hasText: 'سينما' }).getByRole('button', { name: 'شراء' }).click();
  await expect(page.getByText('الرصيد غير كافٍ')).toBeVisible();
  await expect(page.locator('.modal')).toContainText('250');
  await page.getByRole('button', { name: 'حسنًا' }).click();
  expect((await profile(page)).coins).toBe(0);
  await page.getByRole('button', { name: 'التحديات' }).click();
  await addChallenge(page, 'إنجاز كبير', 'legendary', true);
  await completeFirst(page, 'إنجاز كبير');
  expect(await profile(page)).toMatchObject({ xp: 1000, coins: 200 });
  await page.getByRole('button', { name: 'الجوائز' }).click();
  await page.locator('.reward-card', { hasText: 'كتاب' }).getByRole('button', { name: 'شراء' }).click();
  await page.getByRole('button', { name: 'اشترِ' }).click();
  await expect(page.locator('.reward-card', { hasText: 'كتاب' })).toHaveCount(0);
  expect((await profile(page)).coins).toBe(150);
  expect((await profile(page)).xp).toBe(1000);
  await page.getByRole('button', { name: 'المشتريات' }).click();
  await expect(page.locator('.history-list')).toContainText('شراء جائزة: كتاب');
  await closeSheet(page);
});

test('السجل يعرض الإكمال والترقية بقيمها التاريخية', async ({ page }) => {
  await addChallenge(page, 'ضخم', 'easy');
  // تعديل إلى مفتوح بقيم كبيرة ثم الإكمال عبر عدة مستويات
  await page.getByRole('button', { name: 'الإعدادات' }).click();
  await page.getByRole('button', { name: 'تعديل ضخم' }).click();
  await page.locator('.editor select').selectOption('open');
  const nums = page.locator('.editor input[inputmode=numeric]');
  await nums.nth(0).fill('15300');
  await nums.nth(1).fill('0');
  await page.getByRole('button', { name: 'حفظ' }).click();
  await closeSheet(page);
  await completeFirst(page, 'ضخم');
  await expect(page.locator('.celebration')).toBeVisible();
  await page.getByRole('button', { name: 'إغلاق الكل' }).click();
  expect(await profile(page)).toMatchObject({ xp: 15300, gems: 420 });
  await page.getByRole('button', { name: 'السجل' }).click();
  await expect(page.locator('.history-list')).toContainText('إكمال الرتبة 1');
  await expect(page.locator('.history-list')).toContainText('إكمال شريط المستوى 5');
  await page.reload();
  await expect(page.locator('.celebration')).toHaveCount(0);
  expect(await profile(page)).toMatchObject({ xp: 15300, gems: 420 });
});

test('لا تمرير أفقي للصفحة على هاتف صغير وحاسوب', async ({ page }) => {
  for (const [w, h] of [
    [360, 640],
    [1280, 800],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    for (const tab of ['التحديات', 'الجوائز', 'المجموعة', 'القتال']) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(over, `${tab} @${w}`).toBeLessThanOrEqual(0);
    }
  }
});
