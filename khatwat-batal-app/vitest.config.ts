import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // توقيت ذو تغيير صيفي لاختبار التجدد عند منتصف الليل المحلي
    env: { TZ: 'America/New_York' },
  },
});
