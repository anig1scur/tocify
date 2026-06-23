import {sveltekit} from '@sveltejs/kit/vite';
import {SvelteKitPWA} from '@vite-pwa/sveltekit';
import {defineConfig} from 'vite';

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
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024
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
    target: 'es2018',
    chunkSizeWarningLimit: 1000
  }
});
