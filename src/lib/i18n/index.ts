import {register, init, getLocaleFromNavigator} from 'svelte-i18n';

register('en', () => import('./locales/en.json'));
register('zh', () => import('./locales/zh.json'));

const isBrowser = typeof window !== 'undefined';

function getInitialLocale() {
  if (!isBrowser) {
    return 'en';
  }

  try {
    const detected = getLocaleFromNavigator();
    if (detected && detected.startsWith('zh')) {
      return 'zh';
    }
  } catch (e) {
    console.warn('Failed to detect locale', e);
  }

  return 'en';
}

init({
  fallbackLocale: 'en',
  initialLocale: getInitialLocale(),
});