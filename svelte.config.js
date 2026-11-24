import node from '@sveltejs/adapter-node';
import vercel from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),

  kit: {
    adapter: process.env.VITE_TOCIFY_LOCAL === '1'
      ? node({ out: 'build/local', precompress: false })
      : vercel({ runtime: 'nodejs22.x' }),
    serviceWorker: {
      register: false,
    },

    // paths: {
    //   base: '',
    // },
  },

  onwarn: (warning, handler) => {
    const { code } = warning;
    if (code === 'css_unused_selector') return;

    handler(warning); // Handle other warnings
  },
};

export default config;
