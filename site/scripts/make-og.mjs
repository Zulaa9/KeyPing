// Genera public/img/og-es.png y og-en.png (1200x630) a partir de HTML local.
// Herramienta puntual: necesita Playwright instalado (no es dependencia del sitio).
// Uso: node scripts/make-og.mjs
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const logo = (await readFile(new URL('../public/img/icon-512.png', import.meta.url))).toString('base64');
const copy = {
  es: { h: 'Tu enlace para cambiar la contraseña, a un clic.', p: 'Gestor de contraseñas local para Windows y Linux. Sin cuenta ni nube.' },
  en: { h: 'Your password-change link, one click away.', p: 'Local password manager for Windows and Linux. No account, no cloud.' },
};
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const [lang, c] of Object.entries(copy)) {
  await page.setContent(`<!doctype html><html lang="${lang}"><body style="margin:0">
  <div style="width:1200px;height:630px;box-sizing:border-box;padding:80px 90px;display:flex;flex-direction:column;justify-content:center;gap:28px;
    font-family:Inter,system-ui,'Segoe UI',Roboto,Ubuntu,'DejaVu Sans',sans-serif;color:#e6e9ef;
    background:radial-gradient(900px 500px at 90% -10%,rgba(37,99,235,.45),transparent 60%),radial-gradient(700px 400px at 0% 110%,rgba(14,165,233,.25),transparent 60%),#0b1220">
    <div style="display:flex;align-items:center;gap:22px"><img src="data:image/png;base64,${logo}" width="96" height="96"><span style="font-size:56px;font-weight:800;letter-spacing:-1px">KeyPing</span></div>
    <div style="font-size:60px;font-weight:800;line-height:1.1;letter-spacing:-1.5px;max-width:960px">${c.h}</div>
    <div style="font-size:30px;color:#a3adbd">${c.p}</div>
    <div style="font-size:24px;color:#7cb5ff;font-weight:700">keyping.zula.dev</div>
  </div></body></html>`);
  await page.screenshot({ path: new URL(`../public/img/og-${lang}.png`, import.meta.url).pathname });
  console.log('og', lang);
}
await browser.close();
