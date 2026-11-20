// Comprueba los enlaces de dist/: internos (archivo y ancla) y externos (incluidas las descargas).
// Uso: node scripts/check-links.mjs            -> internos + externos
//      node scripts/check-links.mjs --offline  -> solo internos
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../dist/', import.meta.url));
const SITE = 'https://keyping.zula.dev';
const offline = process.argv.includes('--offline');

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

const files = (await walk(ROOT)).filter((f) => f.endsWith('.html'));
const ids = new Map();
const refs = [];
for (const f of files) {
  const html = await readFile(f, 'utf8');
  const pagePath = '/' + relative(ROOT, f).replace(/index\.html$/, '');
  ids.set(pagePath, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  for (const m of html.matchAll(/\s(?:href|src|srcset|content)="([^"]+)"/g)) {
    const attr = m[0].trim().split('=')[0];
    const values = attr === 'srcset' ? m[1].split(',').map((s) => s.trim().split(/\s+/)[0]) : [m[1]];
    for (const v of values) {
      if (attr === 'content' && !/^https?:\/\//.test(v)) continue;
      refs.push({ from: pagePath, url: v.replace(/&amp;/g, '&') });
    }
  }
}

const problems = [];
const external = new Map();
for (const { from, url } of refs) {
  if (/^(mailto:|tel:|data:|javascript:)/.test(url)) { problems.push(`${from}: esquema no permitido ${url}`); continue; }
  let target = url;
  if (target.startsWith(SITE)) target = target.slice(SITE.length) || '/';
  if (/^https?:\/\//.test(target)) {
    if (!external.has(target)) external.set(target, new Set());
    external.get(target).add(from);
    continue;
  }
  // Descargas servidas por la función de Cloudflare (functions/files): no son archivos estáticos.
  if (/^\/files\/v\d+\.\d+\.\d+\/[A-Za-z0-9.-]+$/.test(target)) continue;
  const u = new URL(target, `http://x${from}`);
  let p = decodeURIComponent(u.pathname);
  let file = join(ROOT, p);
  try {
    const s = await stat(file);
    if (s.isDirectory()) { file = join(file, 'index.html'); await stat(file); }
  } catch {
    problems.push(`${from}: no existe ${url}`);
    continue;
  }
  if (u.hash) {
    const pageKey = p.endsWith('/') ? p : p.endsWith('.html') ? p : p + '/';
    const set = ids.get(pageKey) ?? ids.get(p);
    if (!set || !set.has(u.hash.slice(1))) problems.push(`${from}: ancla inexistente ${url}`);
  }
}
console.log(`Internos: ${refs.length - [...external.values()].reduce((a, s) => a + s.size, 0)} referencias en ${files.length} páginas`);

if (!offline) {
  let ok = 0;
  for (const [url, from] of external) {
    let status = 0, err = '';
    for (const method of ['HEAD', 'GET']) {
      try {
        const res = await fetch(url, { method, redirect: 'follow', headers: { 'User-Agent': 'keyping-site-linkcheck' }, signal: AbortSignal.timeout(20_000) });
        status = res.status;
        if (method === 'GET') res.body?.cancel();
        if (status < 400) break;
      } catch (e) { err = e.message; }
    }
    if (status >= 200 && status < 400) { ok++; console.log(`  ${status} ${url}`); }
    else problems.push(`externo ${status || err} ${url} (desde ${[...from].join(', ')})`);
  }
  console.log(`Externos: ${ok}/${external.size} correctos`);
} else {
  console.log(`Externos: ${external.size} sin comprobar (--offline)`);
}

if (problems.length) {
  console.error(`\n${problems.length} problema(s):\n` + problems.map((p) => '  - ' + p).join('\n'));
  process.exit(1);
}
console.log('Sin enlaces rotos.');
