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
export const PORTFOLIO_URL = 'https://zula.dev';
export const AUTHOR_URL = 'https://github.com/Zulaa9';
