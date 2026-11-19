# Web de KeyPing (keyping.zula.dev)

Sitio estático con [Astro](https://astro.build) que explica qué es KeyPing, por qué es de fiar y lleva a la descarga.
Es independiente de `keyping-ui/`: tiene su propio `package.json` y no comparte dependencias con la app.

- Sin backend, cookies, analítica, almacenamiento del navegador ni recursos de terceros (fuentes del sistema).
- El build desactiva la telemetría de Astro (`ASTRO_TELEMETRY_DISABLED=1` en el workflow; en local, `npx astro telemetry disable`).
- Español en `/` y inglés en `/en/`, con `hreflang`, selector visible y una sugerencia de idioma que nunca redirige.
- Modo claro y oscuro según el sistema. Colores e icono de la app.
- CSP en `<meta>` sin `unsafe-inline` (ni scripts ni estilos en línea) y `referrer-policy`.
- Los datos de descarga (versión, fecha, tamaños, SHA-256) se obtienen **en el build** de la API pública de GitHub.

## Estructura

```
site/
├── astro.config.mjs          # salida estática, sin CSS/JS en línea, sin data: URIs
├── public/
│   ├── CNAME                 # keyping.zula.dev (se copia a la salida)
│   ├── js/site.js            # único script: botón de descarga según el sistema y sugerencia de idioma
│   ├── img/                  # iconos (de keyping-ui/public/icon.png) e imágenes Open Graph
│   ├── robots.txt, favicon.ico, apple-touch-icon.png, site.webmanifest
├── scripts/
│   ├── check-links.mjs       # comprobador de enlaces internos y externos de dist/
│   ├── e2e.mjs               # pruebas con Playwright (y axe si AXE_PATH apunta a axe.min.js)
│   ├── serve.mjs             # servidor local que imita GitHub Pages (404.html con estado 404)
│   ├── release-snapshot.mjs  # actualiza la release de respaldo
│   └── make-og.mjs           # regenera las imágenes Open Graph (necesita Playwright)
└── src/
    ├── assets/screens/{es,en}/  # capturas reales de la 1.3.0 con datos ficticios (PNG fuente)
    ├── data/release-fallback.json  # última release conocida (respaldo)
    ├── i18n/routes.ts        # rutas por idioma y enlaces comunes
    ├── layouts/Base.astro    # <head> (SEO, CSP, hreflang, OG), cabecera y pie
    ├── components/           # DownloadButton, Screenshot (AVIF + WebP responsive)
    ├── lib/release*.{ts,mjs} # consulta de la release en build con respaldo
    ├── pages/                # rutas es y en/ (cada una monta su vista) + sitemap.xml + 404
    ├── styles/global.css
    └── views/                # contenido bilingüe de cada página
```

## Comandos

```bash
cd site
npm ci
npm run dev             # desarrollo en http://localhost:4321
npm run build           # dist/ (consulta la API de GitHub; si falla, usa el respaldo)
npm run build:offline   # dist/ sin red, con src/data/release-fallback.json
npm run check:links     # enlaces internos y externos (añade -- --offline para solo internos)
npm run test:e2e        # Playwright sobre dist/ (necesita Playwright instalado)
npm run release:snapshot  # refresca el respaldo con la última release publicada
```

### Versión de descarga

Los instaladores llevan la versión en el nombre (`KeyPing-Setup-X.Y.Z.exe`, `KeyPing-X.Y.Z.AppImage`), así que
`src/lib/release.ts` pide `releases/latest` a la API durante el build y genera los enlaces directos y las sumas
(leídas de `SHA256SUMS.txt`). Si la API falla, no hay red o la release aún no tiene los dos instaladores, el build
**no falla**: usa `src/data/release-fallback.json` y lo indica en el log. El navegador nunca llama a la API.
Tras publicar una versión conviene ejecutar `npm run release:snapshot` y guardar el cambio, para que el respaldo no
se quede atrás.

## Publicación (pasos que tienes que hacer tú)

Nada de esto está hecho. El workflow `.github/workflows/site.yml` construye y despliega en GitHub Pages al hacer push a
`main` con cambios en `site/`, al publicarse una release, al terminar «Release Linux» y a mano.

1. **Activar Pages**: repositorio KeyPing → Settings → Pages → *Build and deployment* → Source: **GitHub Actions**.
2. **Permitir tags en el entorno** (para el disparo por release): Settings → Environments → `github-pages` →
   *Deployment branches and tags* → añadir la regla de tag `v*`. Sin esto, el despliegue lanzado por una release se
   rechaza; los de `main`, `workflow_run` y manuales funcionan igual.
3. **Primer despliegue**: tras fusionar en `main`, Actions → «Web (keyping.zula.dev)» → *Run workflow*.
4. **Dominio en GitHub**: Settings → Pages → *Custom domain*: `keyping.zula.dev` → Save. (El archivo `CNAME` ya va en
   la salida.) Recomendado: verificar `zula.dev` en tu cuenta (Settings de tu perfil → Pages → *Add a domain*), que
   te pedirá un registro TXT `_github-pages-challenge-Zulaa9.zula.dev`; evita que otra cuenta use tus subdominios.
5. **DNS en Cloudflare** (zona `zula.dev` → DNS → Add record):
   - Tipo `CNAME`, nombre `keyping`, destino `zulaa9.github.io`, **Proxy status: DNS only** (nube gris).
   - Con el proxy activado, GitHub no puede emitir el certificado; déjalo en gris.
6. **HTTPS**: cuando GitHub muestre «DNS check successful» y el certificado esté listo (puede tardar hasta 24 h),
   marca **Enforce HTTPS** en Settings → Pages.
7. Comprueba `https://keyping.zula.dev/`, `/en/`, una ruta inexistente (404) y un botón de descarga.

### Alternativa: Cloudflare Pages

Tu DNS y tu portfolio ya están en Cloudflare Pages. La web también funciona ahí sin cambios (build `npm run build`,
directorio raíz `site`, salida `dist`, variable `NODE_VERSION=22`); además permitiría cabeceras HTTP reales
(`_headers`: CSP con `frame-ancestors`, HSTS…). El inconveniente es que el refresco al publicar una release
necesitaría un *deploy hook*. Con GitHub Pages, la CSP solo puede ir en `<meta>`, que no admite `frame-ancestors`.

## Fuentes de las afirmaciones de seguridad (código de la 1.3.0)

| Afirmación | Fuente |
|---|---|
| AES-256-GCM, nonce 12 B, tag 16 B | `keyping-ui/electron/vault/crypto.ts` (`encryptWithKey`, `GCM_IV_LEN`, `GCM_TAG_LEN`) |
| PBKDF2-HMAC-SHA512, 600.000 iteraciones, sal de 32 B | `crypto.ts` (`AUTH_PBKDF2_ITER`, `deriveNewAuth`) |
| Solo se guarda un verificador, no la contraseña | `crypto.ts` (`makeCheck`, `kp-auth.json`) |
| Clave en memoria que se pone a cero al bloquear | `crypto.ts` (`clearSessionKey`), `main.ts` (`lockSession`) |
| Exportación: PBKDF2-SHA256 600.000, sal 16 B, AES-256-GCM, con la contraseña maestra | `vault/index.ts` (`encryptWithPassword`), `main.ts` (`keyping:exportVault`), `settings.html`/`es.json` (`settings.export.modal.*`) |
| Migración de 1.0.x (120.000 iteraciones) | `crypto.ts` (`LEGACY_PBKDF2_ITER`), `README.md` |
| 3 intentos libres, 5 s que se duplican, tope 1 h, persistente | `electron/auth-attempts.ts` (`DEFAULT_POLICY`, `MAX_COOLDOWN_MS`) |
| Autobloqueo 1–30 min (5 por defecto), al suspender o bloquear | `src/app/core/master-lock.service.ts`, `settings.html` (`min=1 max=30`), `main.ts` (`powerMonitor`) |
| Portapapeles: 20 s si no ha cambiado y al bloquear; exclusión de Win+V | `main.ts` (`CLIPBOARD_TTL_MS`), `clipboard-clear-session.ts`, `windows-clipboard.ts` |
| Enlaces solo http/https, sin credenciales, en el navegador | `electron/url-utils.ts`, `main.ts` (`setWindowOpenHandler`, `will-navigate`) |
| contextIsolation, sandbox, sin nodeIntegration, permisos denegados | `main.ts` (`webPreferences`, `setPermissionRequestHandler`) |
| Excepción en Linux: Electron intenta descargar un diccionario de `redirector.gvt1.com` al arrancar | Observado el 2026-11-19 ejecutando la 1.3.0 en Linux (registro del proxy de red); persiste con `setSpellCheckerEnabled(false)` tras `whenReady` y con `--disable-spell-checking` |
| Fusibles de Electron | `keyping-ui/package.json` (`build.electronFuses`) |
| Única conexión: comprobar actualizaciones (desactivable, sin descarga automática por defecto) | `electron/updates/auto-update.service.ts` (`DEFAULT_PREFERENCES`), `settings.html` |
| Firma Ed25519 de latest*.yml, rechazo sin firma válida | `electron/updates/update-signature.ts`, `auto-update.service.ts`, `docs/RELEASE.md` |
| Sin recuperación de la contraseña maestra | ausencia de cualquier función de recuperación en `electron/` y `src/` |
| Historial 20 por defecto (1–200) | `electron/vault/settings.ts` (`DEFAULT_MAX_HISTORY`, `clampHistory`) |
| Generador 8–40 con `crypto.getRandomValues` | `password-generator.html`, `src/app/core/password-generator.ts` |
| Rutas de datos | `app.getPath('userData')` (`vault/paths.ts`) con el nombre de paquete `keyping-ui` |

## Capturas

Generadas con Electron + Playwright sobre la app 1.3.0 compilada, con un `HOME`/`XDG_CONFIG_HOME` temporal (nunca la
bóveda real), una bóveda nueva y cuentas inventadas en dominios `.example`. Ventana de 1280×800. Astro las convierte en
AVIF y WebP de 480, 800 y 1280 px.
