export const IS_LOCAL = import.meta.env.VITE_TOCIFY_LOCAL === '1';

export const FONT_ASSET_BASE = IS_LOCAL ? '/local-assets/fonts/' : 'https://static.aeriszhu.com/';
