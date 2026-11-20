// Cloudflare Pages Function: sirve las descargas de una release desde keyping.zula.dev.
// Así el navegador descarga sin salir de la web (algunos abren una ventana nueva al seguir un
// enlace de descarga a otro dominio). Los archivos siguen alojados en GitHub Releases: aquí solo
// se reenvían tal cual, sin guardar nada, y GitHub sigue contando las descargas.
const REPO = 'Zulaa9/KeyPing';
const TAG_RE = /^v\d+\.\d+\.\d+$/;
const NAME_RE = /^(KeyPing-Setup-\d+\.\d+\.\d+\.exe|KeyPing-\d+\.\d+\.\d+\.(AppImage|apk)|SHA256SUMS\.txt)$/;
const TYPES = {
  exe: 'application/vnd.microsoft.portable-executable',
  AppImage: 'application/octet-stream',
  apk: 'application/vnd.android.package-archive',
  txt: 'text/plain; charset=utf-8',
};

export function upstreamUrl(tag, name) {
  if (!TAG_RE.test(tag) || !NAME_RE.test(name)) return null;
  return `https://github.com/${REPO}/releases/download/${tag}/${name}`;
}

async function serve({ params, request }, head) {
  const tag = String(params.tag || '');
  const name = String(params.name || '');
  const upstream = upstreamUrl(tag, name);
  if (!upstream) return new Response('Not found', { status: 404 });
  let res;
  try {
    res = await fetch(upstream, { method: head ? 'HEAD' : 'GET', redirect: 'follow', cf: { cacheEverything: true, cacheTtl: 86400 } });
  } catch {
    res = null;
  }
  // Si GitHub falla desde aquí, se manda al navegador al archivo original.
  if (!res || res.status >= 500) return Response.redirect(upstream, 302);
  if (!res.ok) return new Response('Not found', { status: 404 });
  const headers = new Headers({
    'Content-Type': TYPES[name.split('.').pop()] || 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${name}"`,
    'Cache-Control': 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  });
  const len = res.headers.get('Content-Length');
  if (len) headers.set('Content-Length', len);
  return new Response(head ? null : res.body, { status: 200, headers });
}

export const onRequestGet = (ctx) => serve(ctx, false);
export const onRequestHead = (ctx) => serve(ctx, true);
