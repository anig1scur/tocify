import {sveltekit} from '@sveltejs/kit/vite';
import {SvelteKitPWA} from '@vite-pwa/sveltekit';
import {defineConfig} from 'vite';

const localBuild = process.env.VITE_TOCIFY_LOCAL === '1';

export default defineConfig({
  plugins: [
    sveltekit(),
    SvelteKitPWA({
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'favicon.svg', 'favicon.png', 'robots.txt', 'manifest.webmanifest'],
      manifest: false,
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: [
          'client/**/*.{js,css,ico,png,svg,webp,webmanifest,mjs}',
          'prerendered/**/*.{html,json}'
        ],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        runtimeCaching: localBuild ? [
          {
            urlPattern: /^https:\/\/pdf\.aeriszhu\.com\/models\/paddleocr\/PP-OCRv6_(?:tiny|small)_(?:det|rec)_onnx_infer\.tar$/,
            handler: 'CacheFirst',
            options: { cacheName: 'tocify-ocr-models-v1', cacheableResponse: { statuses: [200] } },
          },
          {
            urlPattern: /^https:\/\/static\.aeriszhu\.com\/(?:huiwen-mincho\.ttf|SourceHan(?:Sans|Serif)SC-Regular\.woff2)$/,
            handler: 'CacheFirst',
            options: { cacheName: 'tocify-fonts-v1', cacheableResponse: { statuses: [200] } },
          },
        ] : [],
      }
    })
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('pdfjs-dist')) {
            return 'pdf-worker';
          }
          if (id.includes('pdf-lib')) {
            return 'pdf-lib';
          }
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        }
      }
    },
    target: 'es2020',
    chunkSizeWarningLimit: 1000
  }
});
