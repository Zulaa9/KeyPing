// Flujo móvil completo sobre la build web con la capa de plataforma móvil simulada
// (npm run build:mobile-sim: app móvil propia con la capa nativa simulada). Teléfonos de 360x800 y 412x915, solo datos ficticios
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
  await page.waitForTimeout(250); // fin de la transición de pantalla
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

async function hide(page, hidden) {
  await page.evaluate(h => {
    Object.defineProperty(document, 'visibilityState', { value: h ? 'hidden' : 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

async function noOverflow(page, where) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `desborde en ${where}`);
}

async function run(browser, base, vp) {
  const tag = `${vp.width}x${vp.height}`;
  const ctx = await browser.newContext({ viewport: vp, isMobile: true, hasTouch: true, locale: 'es-ES', acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const t0 = Date.now();
  const step = (msg) => console.log(`  [${tag}] ${msg} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  const rows = page.locator('.rows .row');
  const screen = name => page.locator(`.screen[data-screen="${name}"]`);

  // 1. Crear la bóveda.
  await page.goto(base);
  await page.fill('#setup-pwd', MASTER);
  await page.fill('#setup-confirm', MASTER);
  await shot(page, `${tag}-01-setup`);
  await page.locator('.auth button[type=submit]').tap();
  await page.locator('.tabbar').waitFor({ timeout: 30000 });
  await shot(page, `${tag}-02-empty`);
  step('bóveda creada');

  // 2. Importar el .kpenc del escritorio 1.3.1. El selector deja la app en segundo plano: no debe bloquearse.
  await page.locator('.empty .btn', { hasText: 'Importar' }).tap();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.page .btn.primary').tap()]);
  await hide(page, true);
  await page.waitForTimeout(200);
  await hide(page, false);
  await chooser.setFiles(FIXTURE);
  await page.fill('#import-pwd', EXPECTED.exportPassword);
  await page.locator('.page button[type=submit]').tap();
  await page.locator('.checks .row').first().waitFor({ timeout: 30000 });
  const active = EXPECTED.fullHistory.filter(e => e.active !== false);
  assert.equal(await page.locator('.checks .row').count(), active.length);
  // Misma contraseña maestra que el escritorio: se adopta la del archivo (pide la actual del teléfono).
  assert.equal(await page.isChecked('#import-adopt'), true);
  await page.fill('#import-current', MASTER);
  await shot(page, `${tag}-03-import-review`);
  await page.locator('.page .btn.primary').tap();
  await screen('list').waitFor();
  await rows.first().waitFor();
  assert.equal(await rows.count(), active.length);
  await shot(page, `${tag}-04-list`);
  await noOverflow(page, 'lista');
  step(`importadas ${active.length} entradas (selector abierto sin bloqueo); maestra = la del archivo`);
  const NEW_MASTER = EXPECTED.exportPassword;

  // 3. Urgencia: buscar sin tildes, Intro abre el detalle, «Cambiar contraseña» guarda, copia y abre la web.
  await page.fill('#search', 'nandu');
  assert.equal(await rows.count(), 1);
  await page.press('#search', 'Enter');
  await screen('detail').waitFor();
  await shot(page, `${tag}-05-detail`);
  await noOverflow(page, 'detalle');
  await page.locator('.urgent .btn').tap();
  await screen('newpwd').waitFor();
  const generated = await page.inputValue('#pwd-field');
  assert.ok(generated.length >= 16);
  await page.locator('.strength').waitFor();
  await shot(page, `${tag}-06-newpwd`);
  await page.locator('.actions .btn.primary').tap();
  await screen('detail').waitFor();
  await page.waitForFunction(() => window.__kpSim.opened.length > 0);
  const sim = await page.evaluate(() => ({ opened: window.__kpSim.opened.slice(), clipboard: window.__kpSim.clipboard }));
  assert.deepEqual(sim.opened, ['https://mail.example.com/security/password']);
  assert.equal(sim.clipboard, generated);
  await page.locator('details.history summary').tap();
  await page.locator('.version').first().waitFor();
  assert.equal(await page.locator('.version').count(), 3, 'las tres versiones del escritorio quedan en el historial');
  await page.locator('.secret').waitFor();
  await page.locator('.card .btn', { hasText: 'Mostrar' }).tap();
  assert.equal(await page.locator('.secret.revealed').textContent(), generated);
  await shot(page, `${tag}-07-detail-history`);
  step('urgencia: 3 toques desde la búsqueda; nueva guardada, copiada y web abierta');

  // 4. Añadir una entrada nueva desde el botón flotante.
  await page.goBack();
  await screen('list').waitFor();
  await page.fill('#search', '');
  await page.locator('.fab').tap();
  await screen('edit').waitFor();
  await page.fill('#edit-label', 'Banco ficticio');
  await page.fill('#edit-username', 'cliente.prueba');
  await page.fill('#edit-change-url', 'banco.example.org/clave');
  assert.ok((await page.inputValue('#pwd-field')).length >= 16);
  await shot(page, `${tag}-08-new`);
  await page.locator('.page button[type=submit]').tap();
  await screen('detail').waitFor();
  await page.locator('.card .btn.primary', { hasText: 'Copiar' }).tap();
  await page.locator('.toast').waitFor();
  await page.goBack();
  await screen('list').waitFor();
  assert.equal(await rows.count(), active.length + 1);
  step('entrada nueva guardada y copiada');

  // Copiar desde la lista sin abrir la entrada.
  await page.evaluate(() => { window.__kpSim.clipboard = null; });
  await page.locator('.row-copy').first().tap();
  await page.waitForFunction(() => !!window.__kpSim.clipboard);

  // Salud: puntuación y entradas a revisar (la japonesa y la sin nombre del fixture son cortas).
  await page.locator('.tabbar button', { hasText: 'Salud' }).tap();
  await screen('health').waitFor();
  await page.locator('.score-ring').waitFor();
  assert.ok(await page.locator('.rows .row').count() >= 1);
  await shot(page, `${tag}-14-health`);
  await noOverflow(page, 'salud');
  await page.locator('.rows .row').first().tap();
  await screen('detail').waitFor();
  await page.goBack();
  await screen('health').waitFor();
  step('copiar desde la lista y pestaña Salud');

  // 5. Generador y ajustes.
  await page.locator('.tabbar button', { hasText: 'Generador' }).tap();
  await screen('gen').waitFor();
  await shot(page, `${tag}-09-generator`);
  await page.locator('.tabbar button', { hasText: 'Ajustes' }).tap();
  await screen('settings').waitFor();
  await shot(page, `${tag}-10-settings`);
  await noOverflow(page, 'ajustes');

  // 6. Exportar (guardar y compartir) y comprobar el archivo con el código del escritorio.
  await page.locator('.item', { hasText: 'Exportar' }).tap();
  await screen('export').waitFor();
  await page.fill('#export-pwd', NEW_MASTER);
  await page.locator('.page button[type=submit]').tap();
  await page.locator('.msg.ok').waitFor({ timeout: 30000 });
  await shot(page, `${tag}-11-export`);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.page .btn.primary').tap()]);
  assert.match(download.suggestedFilename(), /^keyping-vault-.*\.kpenc$/);
  const exported = fs.readFileSync(await download.path(), 'utf8');
  const desktopVault = require(path.join(ROOT, 'dist-electron', 'electron', 'vault', 'index.js'));
  const parsed = await desktopVault.parseImportPayload(exported, NEW_MASTER);
  assert.equal(parsed.source, 'master');
  // Al fusionar viajan las entradas activas con sus versiones anteriores; una entrada borrada no.
  const byId = new Map(EXPECTED.fullHistory.map(e => [e.id, e]));
  let chained = 0;
  for (const head of active) for (let e = head; e; e = byId.get(e.previousId)) chained++;
  assert.equal(parsed.entries.length, chained + 2, 'fixture + versión nueva + entrada nueva');
  await page.locator('.page .btn', { hasText: 'Enviar' }).tap();
  await page.waitForFunction(() => window.__kpSim.shared.length === 1);
  // La hoja de compartir simulada no pasa a segundo plano: se agota el margen de 1,5 s que deja la app.
  await page.waitForTimeout(1700);
  step('exportado; el escritorio 1.3.1 lo lee entero');

  // 7. Bloqueo: segundo plano con un secreto a la vista → pantalla de bloqueo sin datos en el DOM.
  await page.goBack();
  await page.locator('.tabbar button', { hasText: 'Contraseñas' }).tap();
  await rows.first().tap();
  await page.locator('.card .btn', { hasText: 'Mostrar' }).tap();
  await page.locator('.secret.revealed').waitFor();
  await page.locator('.card .btn.primary', { hasText: 'Copiar' }).tap();
  await page.locator('.toast').waitFor();
  await hide(page, true);
  await page.locator('.auth #unlock-pwd').waitFor();
  assert.equal(await page.locator('.secret, .row, .version').count(), 0);
  // El portapapeles sigue disponible para pegar en otra app (se vacía a los 20 s, no al bloquear).
  assert.ok(await page.evaluate(() => window.__kpSim.clipboard));
  await hide(page, false);
  await shot(page, `${tag}-12-locked`);
  await page.fill('#unlock-pwd', MASTER); // la antigua ya no vale
  await page.locator('.auth button[type=submit]').tap();
  await page.locator('.msg.error').waitFor({ timeout: 30000 });
  await page.fill('#unlock-pwd', NEW_MASTER);
  await page.locator('.auth button[type=submit]').tap();
  await screen('list').waitFor({ timeout: 30000 });
  assert.equal(await rows.count(), active.length + 1);
  step('bloqueo en segundo plano (portapapeles intacto), la maestra antigua falla y la del archivo abre');

  // Tras reiniciar la app (recarga) todo sigue ahí.
  await page.reload();
  await page.fill('#unlock-pwd', NEW_MASTER);
  await page.locator('.auth button[type=submit]').tap();
  await screen('list').waitFor({ timeout: 30000 });
  assert.equal(await rows.count(), active.length + 1);
  step('reinicio: datos y contraseña maestra persistentes');

  // 8. Idioma.
  await page.locator('.tabbar button', { hasText: 'Ajustes' }).tap();
  await page.locator('.segmented button', { hasText: 'English' }).tap();
  await page.locator('.tabbar button', { hasText: 'Passwords' }).waitFor();
  await page.locator('.segmented button', { hasText: 'Español' }).tap();

  assert.deepEqual(errors, []);
  await ctx.close();
  await restoreFlow(browser, base, vp);
}

// Teléfono nuevo: restaurar desde el .kpenc del escritorio con su contraseña maestra.
async function restoreFlow(browser, base, vp) {
  const tag = `${vp.width}x${vp.height}`;
  const ctx = await browser.newContext({ viewport: vp, isMobile: true, hasTouch: true, locale: 'es-ES' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base);
  await page.locator('.auth .btn', { hasText: 'Restaurar' }).tap();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.auth .btn.primary').tap()]);
  await chooser.setFiles(FIXTURE);
  await page.fill('#restore-pwd', 'otra-cualquiera');
  await page.locator('.auth button[type=submit]').tap();
  await page.locator('.msg.error').waitFor({ timeout: 30000 });
  assert.equal(await page.evaluate(() => Object.keys(localStorage).length), 0, 'contraseña errónea: no se crea nada');
  await page.fill('#restore-pwd', EXPECTED.exportPassword);
  await shot(page, `${tag}-13-restore`);
  await page.locator('.auth button[type=submit]').tap();
  await page.locator('.tabbar').waitFor({ timeout: 60000 });
  const active = EXPECTED.fullHistory.filter(e => e.active !== false).length;
  assert.equal(await page.locator('.rows .row').count(), active);
  await page.reload();
  await page.fill('#unlock-pwd', EXPECTED.exportPassword);
  await page.locator('.auth button[type=submit]').tap();
  await page.locator('.tabbar').waitFor({ timeout: 30000 });
  assert.equal(await page.locator('.rows .row').count(), active);
  assert.deepEqual(errors, []);
  console.log(`  [${tag}] restaurar desde .kpenc: misma maestra que el escritorio, ${active} entradas, persiste tras reiniciar`);
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
