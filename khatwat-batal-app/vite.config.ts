import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// مسارات نسبية (base './') ليعمل البناء على أي استضافة ثابتة أو مسار فرعي.
// مجلد مخرجات الشيفرة 'app' حتى لا يختلط بمجلد صور اللعب 'assets'.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/pwa',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        id: './',
        name: 'خطوة بطل',
        short_name: 'خطوة بطل',
        description: 'تحدياتك اليومية وجوائزك الشخصية وأبطالك ولعبة بطاقات تكتيكية',
        lang: 'ar',
        dir: 'rtl',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        theme_color: '#ff8a4c',
        background_color: '#fff6ea',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,woff2,woff,svg,ico,webmanifest}', 'icons/*.png'],
        globIgnores: ['assets/**', 'assets-display/**'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    assetsDir: 'app',
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
  server: { host: true },
  preview: { host: true },
});
