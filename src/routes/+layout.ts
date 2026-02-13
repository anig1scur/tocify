import '$lib/i18n';

import {browser} from '$app/environment';
import {locale, waitLocale} from 'svelte-i18n';

export const load = async ({ url }) => {
  if (browser) {
    const lang = url.searchParams.get('lang');
    if (lang === 'zh' || lang === 'en') {
      locale.set(lang);
    } else {
      locale.set(window.navigator.language.startsWith('zh') ? 'zh' : 'en');
    }
  }
  await waitLocale();
};

export const prerender = true;
export const ssr = false;
