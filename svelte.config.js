import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),

  kit: {
    adapter: adapter({
      runtime: 'nodejs22.x',
    }),

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
