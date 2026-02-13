import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),

  kit: {
    adapter: adapter(),

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
