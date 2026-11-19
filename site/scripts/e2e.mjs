// Pruebas de la salida construida (dist/) con Playwright.
// Requisitos: Playwright con Chromium (no es dependencia del sitio). Opcional: AXE_PATH=ruta a axe.min.js.
// Uso: node scripts/e2e.mjs [carpeta-de-capturas]
import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import { serve } from './serve.mjs';

const OUT = process.argv[2] || 'test-output';
const PORT = 4398;
const BASE = `http://127.0.0.1:${PORT}`;
const PAGES = {
  es: ['/', '/seguridad/', '/descargar/', '/preguntas/', '/privacidad/'],
  en: ['/en/', '/en/security/', '/en/download/', '/en/faq/', '/en/privacy/'],
};
const WIDTHS = [360, 768, 1440];
const SCHEMES = ['light', 'dark'];
const UA = {
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
};

const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };
let checks = 0;
const axeSource = process.env.AXE_PATH ? await readFile(process.env.AXE_PATH, 'utf8') : null;

await mkdir(OUT, { recursive: true });
const server = await serve(PORT);
const browser = await chromium.launch();

function watch(page, label) {
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') failures.push(`${label}: consola ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => failures.push(`${label}: error JS: ${e.message}`));
  page.on('request', (r) => { const u = new URL(r.url()); if (u.host !== `127.0.0.1:${PORT}`) failures.push(`${label}: petición externa ${r.url()}`); });
}

async function loadAll(page) {
  // Fuerza la carga de las imágenes diferidas antes de la captura de página completa.
  await page.evaluate(async () => {
    for (const img of document.querySelectorAll('img[loading="lazy"]')) img.loading = 'eager';
    await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((ok) => { i.onload = i.onerror = ok; }))));
    // Recorre la página para que el navegador decodifique y pinte cada imagen antes de la captura.
    for (let y = 0; y < document.body.scrollHeight; y += innerHeight / 2) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
    await Promise.all([...document.images].map((i) => i.decode().catch(() => null)));
    scrollTo(0, 0);
  });
}

// 1) Cada página x idioma x ancho x esquema de color
for (const [lang, paths] of Object.entries(PAGES)) {
  for (const path of paths) {
    for (const width of WIDTHS) {
      for (const scheme of SCHEMES) {
        const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, locale: lang === 'es' ? 'es-ES' : 'en-GB' });
        const page = await ctx.newPage();
        const label = `${path} ${width}px ${scheme}`;
        watch(page, label);
        const res = await page.goto(BASE + path, { waitUntil: 'networkidle' });
        checks++; check(res.status() === 200, `${label}: HTTP ${res.status()}`);
        const info = await page.evaluate(() => ({
          lang: document.documentElement.lang,
          sw: document.documentElement.scrollWidth,
          iw: window.innerWidth,
          h1: document.querySelectorAll('h1').length,
          title: document.title,
          desc: document.querySelector('meta[name=description]')?.content || '',
          imgsNoAlt: [...document.images].filter((i) => !i.hasAttribute('alt')).length,
          hreflang: document.querySelectorAll('link[rel=alternate][hreflang]').length,
          headings: [...document.querySelectorAll('h1,h2,h3,h4')].map((h) => +h.tagName[1]),
        }));
        checks += 6;
        check(info.lang === lang, `${label}: lang=${info.lang}`);
        check(info.sw <= info.iw, `${label}: scroll horizontal (${info.sw} > ${info.iw})`);
        check(info.h1 === 1, `${label}: ${info.h1} h1`);
        check(info.title && info.desc, `${label}: falta title o description`);
        check(info.imgsNoAlt === 0, `${label}: ${info.imgsNoAlt} imágenes sin alt`);
        check(info.hreflang === 3, `${label}: hreflang=${info.hreflang}`);
        for (let i = 1; i < info.headings.length; i++) {
          checks++; check(info.headings[i] - info.headings[i - 1] <= 1, `${label}: salto de encabezado h${info.headings[i - 1]}→h${info.headings[i]}`);
        }
        if (axeSource && width === 1440) {
          const actx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, bypassCSP: true });
          const ap = await actx.newPage();
          await ap.goto(BASE + path, { waitUntil: 'networkidle' });
          await ap.addScriptTag({ content: axeSource });
          const r = await ap.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }));
          checks++;
          for (const v of r.violations) failures.push(`${label}: axe ${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`);
          await actx.close();
        }
        await loadAll(page);
        const name = `${lang}${path.replace(/^\/(en\/)?/, '-').replace(/\/$/, '').replace(/\//g, '-') || ''}`.replace(/-$/, '') || lang;
        await page.screenshot({ path: `${OUT}/${name || 'home'}-${width}-${scheme}.png`, fullPage: true });
        await ctx.close();
      }
    }
  }
}

// 2) Botón de descarga según el sistema
for (const [os, ua] of Object.entries(UA)) {
  for (const path of ['/', '/en/']) {
    const ctx = await browser.newContext({ userAgent: ua, viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    watch(page, `UA ${os} ${path}`);
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    const d = await page.evaluate(() => {
      const b = document.querySelector('[data-download]');
      return {
        href: b.querySelector('[data-primary]').getAttribute('href'),
        label: b.querySelector('[data-label]').textContent,
        other: b.querySelector('[data-other]').hidden ? null : b.querySelector('[data-other]').getAttribute('href'),
        unsupported: !b.querySelector('[data-unsupported]').hidden,
      };
    });
    checks += 2;
    if (os === 'windows') { check(/KeyPing-Setup-.*\.exe$/.test(d.href), `UA windows ${path}: href ${d.href}`); check(/AppImage$/.test(d.other || ''), `UA windows ${path}: otra ${d.other}`); }
    if (os === 'linux') { check(/KeyPing-.*\.AppImage$/.test(d.href), `UA linux ${path}: href ${d.href}`); check(/\.exe$/.test(d.other || ''), `UA linux ${path}: otra ${d.other}`); }
    if (os === 'mac') { check(/\/(descargar|en\/download)\/$/.test(d.href), `UA mac ${path}: href ${d.href}`); check(d.unsupported, `UA mac ${path}: sin aviso de plataforma`); }
    console.log(`UA ${os} ${path}: ${d.label} -> ${d.href}${d.other ? ' | otra: ' + d.other : ''}`);
    if (path === '/') await page.screenshot({ path: `${OUT}/ua-${os}.png` });
    await ctx.close();
  }
}

// 3) Selector de idioma: cada página enlaza con su equivalente
for (const [lang, paths] of Object.entries(PAGES)) {
  const other = lang === 'es' ? 'en' : 'es';
  for (const [i, path] of paths.entries()) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE + path);
    await page.click('.lang-switch');
    await page.waitForLoadState();
    checks += 2;
    check(new URL(page.url()).pathname === PAGES[other][i], `idioma ${path}: fue a ${page.url()}`);
    check((await page.evaluate(() => document.documentElement.lang)) === other, `idioma ${path}: lang incorrecto`);
    await ctx.close();
  }
}

// 4) Sugerencia de idioma: solo si el navegador prefiere el otro idioma y se llega desde fuera
for (const [locale, path, expect] of [['en-US', '/', true], ['es-ES', '/', false], ['es-ES', '/en/', true], ['en-GB', '/en/', false]]) {
  const ctx = await browser.newContext({ locale });
  const page = await ctx.newPage();
  await page.goto(BASE + path);
  const visible = await page.isVisible('#lang-suggest');
  checks++; check(visible === expect, `sugerencia ${locale} ${path}: visible=${visible}`);
  check(new URL(page.url()).pathname === path, `sugerencia ${locale} ${path}: redirigió`);
  await ctx.close();
}

// 5) 404
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // Aquí el 404 del documento es lo esperado: solo se vigilan errores de JS y peticiones externas.
  page.on('pageerror', (e) => failures.push(`404: error JS: ${e.message}`));
  page.on('request', (r) => { if (new URL(r.url()).host !== `127.0.0.1:${PORT}`) failures.push(`404: petición externa ${r.url()}`); });
  const res = await page.goto(BASE + '/no-existe/');
  checks += 2;
  check(res.status() === 404, `404: HTTP ${res.status()}`);
  check((await page.textContent('h1')).includes('no existe'), '404: contenido');
  await page.screenshot({ path: `${OUT}/404.png`, fullPage: true });
  await ctx.close();
}

// 6) Teclado: el primer Tab muestra el enlace «Saltar al contenido» con foco visible
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE + '/');
  await page.keyboard.press('Tab');
  const f = await page.evaluate(() => ({ cls: document.activeElement.className, outline: getComputedStyle(document.activeElement).outlineStyle, top: document.activeElement.getBoundingClientRect().top }));
  checks += 2;
  check(f.cls === 'skip', `teclado: primer foco en ${f.cls}`);
  check(f.outline !== 'none' && f.top >= 0, 'teclado: foco no visible');
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${checks} comprobaciones, ${failures.length} fallos. Capturas en ${OUT}/`);
if (failures.length) { console.error([...new Set(failures)].map((f) => '  - ' + f).join('\n')); process.exit(1); }
