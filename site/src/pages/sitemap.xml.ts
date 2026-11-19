import type { APIRoute } from 'astro';
import { ROUTES } from '../i18n/routes';

// Sitemap con alternativas por idioma (hreflang). Sin dependencias.
export const GET: APIRoute = ({ site }) => {
  const keys = Object.keys(ROUTES.es) as (keyof typeof ROUTES.es)[];
  const abs = (p: string) => new URL(p, site).href;
  const urls = keys.flatMap((k) =>
    (['es', 'en'] as const).map((lang) => `  <url>
    <loc>${abs(ROUTES[lang][k])}</loc>
    <xhtml:link rel="alternate" hreflang="es" href="${abs(ROUTES.es[k])}"/>
    <xhtml:link rel="alternate" hreflang="en" href="${abs(ROUTES.en[k])}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${abs(ROUTES.es[k])}"/>
  </url>`),
  );
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>
`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
