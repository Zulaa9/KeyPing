export const LANGS = ['es', 'en'] as const;
export type Lang = (typeof LANGS)[number];
export type PageKey = 'home' | 'security' | 'download' | 'faq' | 'privacy' | 'notFound';

// Rutas propias por idioma. El español va en la raíz (x-default) y el inglés en /en/.
export const ROUTES: Record<Lang, Record<Exclude<PageKey, 'notFound'>, string>> = {
  es: { home: '/', security: '/seguridad/', download: '/descargar/', faq: '/preguntas/', privacy: '/privacidad/' },
  en: { home: '/en/', security: '/en/security/', download: '/en/download/', faq: '/en/faq/', privacy: '/en/privacy/' },
};

export const REPO_URL = 'https://github.com/Zulaa9/KeyPing';
export const LICENSE_URL = 'https://github.com/Zulaa9/KeyPing/blob/main/LICENSE';
export const TRADEMARK_URL = 'https://github.com/Zulaa9/KeyPing/blob/main/TRADEMARK.md';
// El portfolio tiene el inglés en la raíz y el español en /es/.
export const PORTFOLIO_URL: Record<Lang, string> = { es: 'https://zula.dev/es/', en: 'https://zula.dev/' };
export const PORTFOLIO_PROJECTS_URL: Record<Lang, string> = { es: 'https://zula.dev/es/projects/', en: 'https://zula.dev/projects/' };
// Ficha de KeyPing en Microsoft Store (versión firmada por Microsoft, actualizada por la Store).
export const STORE_URL = 'https://apps.microsoft.com/detail/9N168Z5TZT05';
export const AUTHOR_URL = 'https://github.com/Zulaa9';
