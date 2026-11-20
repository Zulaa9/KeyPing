# KeyPing móvil (rama `movil`)

Estado: implementado y probado en navegador (Playwright) y con tests; APK de depuración e instalación en dispositivo
pendientes de confirmar (ver «Pruebas»). Nada publicado, firmado con claves de publicación ni subido a tiendas.

## 1. Enfoque y estructura

- **Capacitor 8.6** sobre la misma app Angular 20. Un solo código de interfaz; la plataforma se elige al compilar
  (`ng build --configuration mobile`) y al arrancar (`src/main.ts` → `installPlatform()`).
- **Núcleo compartido `core/`** (TypeScript sin dependencias de Node ni del DOM):
  `export-format.ts` (formato `.kpenc`), `vault-model.ts`, `vault-ops.ts` (cargar/guardar/historial),
  `keyping-service.ts` (implementa el mismo contrato `window.keyping` que el preload de Electron),
  `password-check.ts`, `similarity.ts`, `attempt-policy.ts`, `crypto-provider.ts` con dos implementaciones:
  `electron/vault/node-crypto.ts` (escritorio) y `core/web-crypto.ts` (móvil, Web Crypto).
- **Escritorio**: `electron/` delega en `core/` (mismo comportamiento y mismos ficheros en disco).
- **Capa de plataforma** `src/app/platform/`: `platform.ts` (escritorio, sin cambios), `platform.mobile.ts`
  (plugin nativo `KeypingNative`), `platform.mobile-sim.ts` (simulador en navegador para Playwright),
  `mobile-bridge.ts` (monta `window.keyping` con `KeypingService`).
- **Android** `android/`: `MainActivity` + `KeypingNativePlugin.java` (ficheros privados, portapapeles sensible,
  enlaces externos, selector de guardado y hoja de compartir, aviso de segundo plano).
- **iOS** `ios/`: proyecto generado por Capacitor, **no compilado** y sin el plugin nativo en Swift (ver §8).

## 2. Inventario de funciones

| Función de escritorio | Móvil |
|---|---|
| Crear/desbloquear bóveda, contraseña maestra, política de intentos (3 libres, 5 s ×2, máx. 1 h) | Portada |
| Lista, búsqueda, detalle, editar, borrar, historial de versiones, carpetas | Portada (carpeta se edita en el detalle; sin arrastrar y soltar) |
| Análisis de contraseña (patrones, similitud con la bóveda) | Portada |
| Generador | Adaptada: hoja inferior en lugar de panel flotante arrastrable |
| Enlace «Cambiar contraseña» (flujo de emergencia) | Portada: buscar → detalle → botón; solo http/https en el navegador del sistema |
| Copiar contraseña con limpieza a los 20 s | Adaptada: portapapeles marcado como sensible (Android 13+) y limpieza automática |
| Exportar `.kpenc` | Adaptada: selector del sistema «Guardar» o «Compartir» |
| Importar `.kpenc` / JSON | Adaptada: selector del sistema |
| Idiomas es/en | Portada (mismas claves) |
| Bloqueo por inactividad | Portada + bloqueo al pasar a segundo plano |
| Autoactualización firmada (updater) | No aplicable: la actualiza la tienda |
| Ventana: ampliar, minimizar, bandeja, atajos globales | No aplicable |
| Exportación nativa v1 `.keyping` | No aplicable: depende de la clave de sesión del equipo (no portable); al importarla se explica el error |

## 3. Formato de exportación (portabilidad)

El único formato portable es **v2 `.kpenc`**, idéntico en escritorio 1.3.1 y en móvil (no se ha cambiado nada):

```json
{ "format": "keyping-export-v2", "enc": "master", "iterations": 600000,
  "salt": "<base64, 16 bytes>", "data": "<base64: iv(12) || tag(16) || ciphertext>" }
```

- Clave: PBKDF2-HMAC-SHA256 sobre la contraseña de exportación (UTF-8), 32 bytes, `iterations` del fichero
  (se aceptan 100 000–2 000 000). Cifrado AES-256-GCM.
- Texto claro: `JSON.stringify({ entries, hashVersion })`. Los `hash` de las entradas se recalculan al importar con
  la clave HMAC de cada dispositivo, así que no hace falta compartir secretos de la bóveda.
- La bóveda interna sigue igual: `kp-auth.json` (PBKDF2-HMAC-SHA512, 600 000 iteraciones, sal 32 bytes),
  `keyping-vault` AES-256-GCM, `kp-hash` HMAC. En móvil van en el almacenamiento privado de la app.
- Errores distinguidos: contraseña incorrecta, fichero truncado, manipulado (etiqueta GCM), formato desconocido y
  exportación nativa no portable (`import-native-key-mismatch`).

## 4. Cambios en escritorio

- Refactor sin cambio de comportamiento: lógica movida a `core/` y reexportada desde `electron/`.
- `main` de `package.json` → `dist-electron/electron/main.js` (por `rootDir ..`); scripts de firma del updater
  apuntan a esa ruta. Comprobado: `build:linux` genera el AppImage y arranca.
- `electron.service.ts` gana `isMobile()` y `saveExportFile()`; en escritorio no cambian los flujos.
- Formato de exportación, bóveda y empaquetado Windows/Linux/MSIX: sin cambios.

## 5. Pruebas ejecutadas (entorno Linux en la nube)

| Comando | Resultado |
|---|---|
| `npm test` (Angular) | 46/46 OK, antes y después |
| `npm run test:electron` | 59/59 OK |
| `npm run test:core` | 18 OK + 1 omitida (necesita `KP_BASELINE_DIST`) |
| `KP_DESKTOP_DIST=<1.3.1 sin modificar> npm run test:core` | 18 OK + 1 omitida: el escritorio 1.3.1 original lee lo que exporta el núcleo nuevo |
| `KP_BASELINE_DIST=<1.3.1> …` | 19/19 OK: bóveda creada por 1.3.1 abierta por el núcleo nuevo y al revés |
| `npm run build:linux` | OK, `KeyPing-1.3.1.AppImage`, arranca con HOME temporal |
| `npm run test:mobile-e2e` (360×800 y 412×915) | OK: crear bóveda, importar fixture de escritorio, buscar, abrir enlace de cambio, generar y guardar con historial, exportar y verificar con el parser de escritorio, bloquear/desbloquear |

Fixtures: `core/tests/fixtures/` generados con el escritorio 1.3.1 (`scripts/gen-export-fixtures.cjs`), contraseña
de exportación ficticia `Móvil-Exporta-2026!ñ`; incluyen cadena de 3 versiones, texto japonés, entrada borrada y
entrada sin metadatos. Pruebas campo a campo, ida, vuelta e ida y vuelta.

No ejecutado en la nube: compilación del APK (sin acceso a dl.google.com para el SDK) y emulador (sin /dev/kvm).

## 6. Lista manual en dispositivo (pendiente salvo que se indique)

1. Instalar APK de depuración, abrir, crear bóveda ficticia.
2. Importar `desktop-full-history.kpenc` → 3 versiones del «Correo ficticio — Ñandú» y la entrada japonesa.
3. Buscar, abrir detalle, «Cambiar contraseña» abre el navegador del sistema.
4. Copiar: aviso de contenido sensible y portapapeles vacío a los ~20 s.
5. Segundo plano → bloqueada; en recientes, miniatura oculta; capturas negras (FLAG_SECURE).
6. Exportar con «Guardar» y con «Compartir»; importar ese fichero en el escritorio 1.3.1.
7. `dumpsys package dev.zula.keyping` sin permiso INTERNET; copia de seguridad en la nube desactivada.
8. Rendimiento de PBKDF2 600 000 en el móvil (desbloqueo e importación).

Comandos: instalar Android SDK (platform 36, build-tools, platform-tools) y JDK 21; `npm ci`;
`npm run android:apk` → `android/app/build/outputs/apk/debug/app-debug.apk`; `adb install -r <apk>`.

## 7. Google Play (lo hace el usuario; nada hecho)

- Cuenta de desarrollador (pago único 25 USD) y verificación de identidad.
- Clave de subida propia (keystore fuera del repo y con copia) + Play App Signing; compilar `bundleRelease` (.aab).
- Ficha: textos es/en, capturas con datos ficticios, icono 512 px, gráfico 1024×500.
- Política de privacidad pública (p. ej. en keyping.zula.dev): sin recogida de datos, todo local.
- Formulario «Seguridad de los datos»: no se recogen ni comparten datos; cifrado; sin red.
- Clasificación de contenido, público objetivo, prueba cerrada obligatoria para cuentas personales nuevas
  (12 probadores durante 14 días) antes de producción.

## 8. iOS (requisitos)

Mac con Xcode, cuenta Apple Developer (99 USD/año), plugin `KeypingNative` en Swift (ficheros en Application Support
excluidos de iCloud, `UIPasteboard` local con caducidad, ocultar en el selector de apps, `UIDocumentPicker` y hoja de
compartir), y probarlo en un iPhone real.

## 9. Decisiones pendientes del usuario

- `appId` **`dev.zula.keyping`**: es permanente en Google Play una vez publicado.
- Numeración de versiones del móvil (hoy versionName 1.3.1, versionCode 1).
- Texto en escritorio que diga que el `.kpenc` sirve para pasar la bóveda al móvil.
- Si se hace iOS y prioridad frente a Nemulo.
