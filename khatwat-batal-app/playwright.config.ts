import { defineConfig, devices } from '@playwright/test';

// اختبارات الواجهة على نسخة الإنتاج (vite preview) في Chromium، بمقاسات هاتف وحاسوب.
const deployed = process.env.DEPLOYED_URL;

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: deployed ?? 'http://localhost:4173/',
    locale: 'ar',
    timezoneId: 'Africa/Casablanca',
    trace: 'retain-on-failure',
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  // عند التحقق من الموقع المنشور لا حاجة لخادم محلي
  webServer: deployed
    ? undefined
    : {
        command: 'npx vite preview --port 4173 --strictPort',
        url: 'http://localhost:4173/',
        reuseExistingServer: true,
        timeout: 60_000,
      },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
});
