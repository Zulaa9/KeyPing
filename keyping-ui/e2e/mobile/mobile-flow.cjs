// Flujo móvil completo sobre la build web con la capa de plataforma móvil simulada
// (ng build --configuration mobile-sim). Teléfonos de 360x800 y 412x915, solo datos ficticios
// y almacenamiento del navegador de prueba (nunca la bóveda real).
// Requiere Playwright con Chromium (require('playwright')). Uso: npm run test:mobile-e2e
'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const WEB = path.join(ROOT, 'dist', 'keyping-ui-mobile-sim', 'browser');
const OUT = path.join(__dirname, 'output');
const FIXTURE = path.join(ROOT, 'core', 'tests', 'fixtures', 'desktop-full-history.kpenc');
const EXPECTED = JSON.parse(fs.readFileSync(path.join(ROOT, 'core', 'tests', 'fixtures', 'desktop-expected.json'), 'utf8'));
const MASTER = 'Maestra-Movil-123';
const VIEWPORTS = [{ width: 360, height: 800 }, { width: 412, height: 915 }];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
      const file = path.join(WEB, path.normalize(rel));
      if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

async function run(browser, base, vp) {
  const tag = `${vp.width}x${vp.height}`;
  const ctx = await browser.newContext({ viewport: vp, isMobile: true, hasTouch: true, locale: 'es-ES', acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const t0 = Date.now();
  const step = (msg) => console.log(`  [${tag}] ${msg} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

  // 1. Crear la bóveda.
  await page.goto(base);
  await page.click('.intro-card button');
  await page.fill('input[name=masterPassword]', MASTER);
  await page.fill('input[name=masterPasswordConfirm]', MASTER);
  await page.click('.first-time-form button[type=submit]');
  await page.locator('.skip-btn').click({ timeout: 20000 });
  assert.equal(await page.evaluate(() => window.keyping.platform), 'mobile-sim');
  step('bóveda creada');

  // 2. Importar el archivo exportado por el escritorio 1.3.1.
  await page.goto(base + '#/settings');
  await page.setInputFiles('input[type=file]', FIXTURE);
  const importBlock = page.locator('.setting-block', { has: page.locator('input[type=file]') });
  await importBlock.locator('.field input[type=password]').fill(EXPECTED.exportPassword);
  await importBlock.locator('.field button').click();
  await importBlock.locator('.inline-alert.success').waitFor({ timeout: 20000 });
  await importBlock.locator('.block-actions .btn.primary').click();
  const confirm = page.locator('.confirm-modal .btn.primary');
  await confirm.waitFor();
  await page.waitForFunction(() => !document.querySelector('.confirm-modal .btn.primary')?.hasAttribute('disabled'), null, { timeout: 15000 });
  await confirm.click();
  await page.waitForFunction(() => window.keyping.listPasswords().then(l => l.length > 0), null, { timeout: 20000 });
  await page.waitForTimeout(300);
  await shot(page, `${tag}-01-import`);
  const list = await page.evaluate(() => window.keyping.listPasswords());
  assert.equal(list.length, EXPECTED.fullHistory.filter(e => e.active !== false).length);
  step(`importadas ${list.length} entradas activas`);

  // 3. Buscar la cuenta y abrir el enlace de cambio de contraseña (flujo de emergencia).
  await page.goto(base + '#/passwords');
  await page.fill('input[type=search]', 'ñandú');
  const items = page.locator('article.item');
  await items.first().waitFor();
  assert.equal(await items.count(), 1);
  await shot(page, `${tag}-02-search`);
  await items.first().locator('.item-quick').tap();
  const opened = await page.evaluate(() => window.__kpSim.opened.slice());
  assert.deepEqual(opened, ['https://mail.example.com/security/password']);
  step('enlace de cambio abierto en el navegador del sistema');

  // 4. Detalle: generar una contraseña nueva y guardarla (historial).
  await items.first().click();
  await page.locator('.detail').waitFor();
  await shot(page, `${tag}-03-detail`);
  await page.locator('.detail-footer .right .btn.ghost').click();
  await page.locator('.password-row .btn', { hasText: /Generar|Generate/ }).click();
  await page.locator('.detail-footer .btn.primary').click();
  const confirmSave = page.locator('.confirm-modal .btn.primary, .warning-modal .btn.primary');
  if (await confirmSave.count()) await confirmSave.first().click();
  await page.waitForTimeout(500);
  const current = (await page.evaluate(() => window.keyping.listPasswords())).find(e => e.label === 'Correo ficticio — Ñandú');
  const history = await page.evaluate(id => window.keyping.getPasswordHistory(id), current.id);
  assert.equal(history.length, 4, 'tres versiones del escritorio + la nueva');
  assert.notEqual(await page.evaluate(id => window.keyping.getPassword(id), current.id), 'Perro-Verde-2026#');
  await shot(page, `${tag}-04-saved`);
  step('contraseña generada y guardada con historial');

  // 5. Exportar (guardar en archivos) y comprobar el archivo con el código del escritorio.
  await page.goto(base + '#/settings');
  await page.locator('.block-actions .btn.primary', { hasText: /Exportar|Export/ }).click();
  await page.fill('.confirm-modal input[type=password]', MASTER);
  await shot(page, `${tag}-05-export`);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.confirm-modal .btn.primary').click()]);
  assert.match(download.suggestedFilename(), /^keyping-vault-.*\.kpenc$/);
  const exported = fs.readFileSync(await download.path(), 'utf8');
  const desktopVault = require(path.join(ROOT, 'dist-electron', 'electron', 'vault', 'index.js'));
  const parsed = await desktopVault.parseImportPayload(exported, MASTER);
  assert.equal(parsed.source, 'master');
  assert.equal(parsed.entries.length, EXPECTED.fullHistory.length + 1);
  const share = page.locator('.block-actions .btn.primary', { hasText: /Exportar|Export/ });
  await share.click();
  await page.fill('.confirm-modal input[type=password]', MASTER);
  await page.locator('.confirm-modal .btn', { hasText: /Compartir|Share/ }).click();
  await page.waitForFunction(() => window.__kpSim.shared.length === 1);
  step('exportado; el escritorio lo lee con todas las entradas');

  // 6. Bloquear y desbloquear; al pasar a segundo plano también se bloquea.
  await page.locator('.lock-button').click();
  await page.locator('.lock-screen').waitFor();
  assert.deepEqual(await page.evaluate(() => window.keyping.listPasswords()), []);
  await page.fill('input[name=masterPassword]', MASTER);
  await page.locator('.locked-form button[type=submit]').click();
  await page.waitForURL(/#\/passwords/, { timeout: 20000 });
  await shot(page, `${tag}-06-unlocked`);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.locator('.lock-screen').waitFor();
  step('bloqueo manual, desbloqueo y bloqueo en segundo plano');

  // Sin desbordes horizontales en las pantallas principales.
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.deepEqual(errors, []);
  await ctx.close();
}

(async () => {
  if (!fs.existsSync(path.join(WEB, 'index.html'))) throw new Error('Falta la build: npm run build:mobile-sim');
  if (!fs.existsSync(path.join(ROOT, 'dist-electron', 'electron', 'vault', 'index.js'))) throw new Error('Falta dist-electron: npm run electron:build');
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  try {
    for (const vp of VIEWPORTS) {
      console.log(`Viewport ${vp.width}x${vp.height}`);
      await run(browser, base, vp);
    }
    console.log('OK: flujo móvil completo en', VIEWPORTS.map(v => `${v.width}x${v.height}`).join(' y '));
  } finally {
    await browser.close();
    server.close();
  }
})().catch(err => { console.error(err); process.exit(1); });
