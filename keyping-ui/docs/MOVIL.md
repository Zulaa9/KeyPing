# KeyPing móvil (rama `movil`)

Estado: implementado; probado con tests, Playwright y en un Nothing Phone 3 (APK de depuración). Nada publicado, firmado con claves de publicación ni subido a tiendas.

## 1. Enfoque y estructura

- **App móvil propia** (proyecto Angular `keyping-mobile`, carpeta `mobile/`), diseñada para el teléfono; no reutiliza
  pantallas del escritorio. **Capacitor 8.6** la empaqueta para Android (`android/`); iOS preparado (`ios/`).
- **Núcleo compartido `core/`** (TypeScript sin Node ni DOM), el mismo que usa el escritorio:
  `keyping-service.ts` (bóveda, intentos, historial, exportar/importar), `export-format.ts` (`.kpenc`),
  `vault-model.ts`, `vault-ops.ts`, `password-check.ts`, `similarity.ts`, `password-generator.ts`, `url-utils.ts`,
  `attempt-policy.ts` y `crypto-provider.ts` con dos implementaciones: `electron/vault/node-crypto.ts` (escritorio) y
  `core/web-crypto.ts` (móvil).
- **Escritorio**: `electron/` delega en `core/`; la interfaz (`src/`) es idéntica a 1.3.1 salvo dos reexportaciones.
- **Capa nativa** `mobile/src/app/platform/`: `platform.ts` (plugin `KeypingNative`), `platform.sim.ts` (simulador en
  navegador para Playwright), `mobile-bridge.ts` (instancia el núcleo; bloqueo al pasar a segundo plano salvo durante un
  selector o la hoja de compartir abiertos por la propia app, con un máximo de 3 min).
- **Android**: `MainActivity` (FLAG_SECURE) + `KeypingNativePlugin.java` (ficheros privados con escritura atómica,
  portapapeles sensible con limpieza, enlaces solo http/https, guardar/compartir/abrir archivos con el selector del
  sistema). Sin permiso INTERNET, sin copia de seguridad en la nube, `loggingBehavior: 'none'`.

## 2. Pantallas e inventario de funciones

Pestañas inferiores: **Contraseñas** (buscador fijo, carpetas en chips, filas grandes, botón +), **Generador** y
**Ajustes**. Pantallas apiladas con el botón Atrás del sistema: detalle, añadir/editar, contraseña nueva, exportar,
importar y contraseña maestra.

Flujo de urgencia: buscar (sin tildes) → Intro abre el primer resultado → «Cambiar contraseña en la web» → «Guardar,
copiar y abrir la web». La nueva se guarda antes de salir de la app (la anterior queda en el historial) para que no se
pierda si el sistema cierra o bloquea la app mientras se está en el navegador.

| Función de escritorio | Móvil |
|---|---|
| Crear/desbloquear bóveda, contraseña maestra, política de intentos (3 libres, 5 s ×2, máx. 1 h) | Portada |
| Lista, búsqueda, detalle, editar, borrar, historial (recuperar/borrar versiones), carpetas | Adaptada al tacto (carpeta como campo y chips; sin arrastrar y soltar) |
| Análisis de contraseña (patrones, similitud con la bóveda) | Portada, bajo el campo de contraseña |
| Generador | Adaptado: dentro del campo de contraseña y como pestaña |
| Enlace de cambio de contraseña | Adaptado: guarda, copia y abre la web en un toque |
| Copiar con limpieza a los 20 s | Portapapeles marcado como sensible (Android 13+) y limpieza automática |
| Exportar / importar `.kpenc` | Flujo guiado; selector del sistema y hoja de compartir (el nombre del archivo usa la hora UTC, igual que el escritorio) |
| Versiones guardadas por entrada | Portada (5, 10 o 20) |
| Idiomas es/en | Portada (textos propios del móvil, mismas reglas del analizador) |
| Bloqueo por inactividad | Portado (1, 5 o 15 min) + bloqueo al pasar a segundo plano |
| Autoactualización, ventana, bandeja, atajos, comprobación de integridad | No aplicable (la tienda actualiza; sin ventanas) |
| Exportación nativa v1 `.keyping` | No aplicable: depende de la clave del equipo; al importarla se explica el error |

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

- Interfaz (`src/`) idéntica a 1.3.1; `src/app/core/url-utils.ts` y `password-generator.ts` reexportan `core/`.
- Lógica de `electron/` movida a `core/` sin cambio de comportamiento; `main` de `package.json` →
  `dist-electron/electron/main.js` y los scripts de firma del updater apuntan ahí. `build:linux` genera y arranca el AppImage.
- Formato de exportación, bóveda y empaquetado Windows/Linux/MSIX: sin cambios.

## 5. Pruebas

| Comando | Resultado |
|---|---|
| `npm test` (Angular escritorio) | 46/46 OK |
| `npm run test:electron` | 59/59 OK |
| `npm run test:core` | 18 OK + 1 omitida (necesita `KP_BASELINE_DIST`) |
| Con `KP_DESKTOP_DIST` / `KP_BASELINE_DIST` apuntando al 1.3.1 sin modificar | 18 + 1 omitida / 19 OK: compatibilidad en ambos sentidos |
| `npm run build:linux` | AppImage generado y arrancado con HOME temporal (antes de rehacer la app móvil; el escritorio no ha cambiado desde entonces) |
| `npm run test:mobile-e2e` (360×800 y 412×915) | OK: crear bóveda, importar el `.kpenc` del escritorio con el selector abierto sin bloqueo, buscar sin tildes, urgencia (guardar, copiar, abrir web, historial), añadir con generador, exportar y leerlo con el escritorio, compartir, bloqueo en segundo plano sin datos en pantalla, intento fallido, desbloqueo, idioma |
| Dispositivo real (Nothing Phone 3, Android 17) | Versión anterior: sin INTERNET, portapapeles sensible y limpio a 20,0 s, recientes ocultos, exportar e importar OK; 3 fallos corregidos. App nueva (a23cac3): abre la bóveda creada por la anterior; importar con el selector sin bloqueo; urgencia abre el navegador y guarda la nueva con 3 versiones previas; segundo plano → bloqueo sin datos en 0,3 s; logcat sin el texto copiado; portapapeles vacío a 20 s; exportar/compartir sin bloqueo; sin INTERNET. Corregidos después: Atrás del sistema salía de la app, contador de versiones a 0 hasta desplegar, barras sobre el teclado, rotación libre |

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
