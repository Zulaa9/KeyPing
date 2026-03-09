# KeyPing

[English](./README.md) | [Espanol](./README.es.md)

**KeyPing es un gestor de contrasenas de escritorio centrado en privacidad, que mantiene todo en local y te ayuda a evitar contrasenas debiles, reutilizadas o demasiado parecidas.**

[![Release](https://img.shields.io/github/v/release/Unax-Zulaika-Fuente/KeyPing?label=release)](https://github.com/Unax-Zulaika-Fuente/KeyPing/releases)
[![Plataforma](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-0f172a)](https://github.com/Unax-Zulaika-Fuente/KeyPing/releases)
[![Stack](https://img.shields.io/badge/stack-Angular%20%2B%20Electron-2563eb)](./keyping-ui)
[![Licencia](https://img.shields.io/badge/license-Apache--2.0-green)](./LICENSE)

## Estado del proyecto

Desarrollo activo. Las funcionalidades base son estables y se estan mejorando de forma continua en UX, seguridad y cobertura de tests.

## Capturas

Anade estos archivos en `docs/screenshots/`:

- `dashboard.png`
- `password-list.png`
- `password-health.png`
- `password-health2.png`
- `generator.png`
- `settings.png`
- `settings2.png`

Vista previa renderizada:

![Dashboard](docs/screenshots/dashboard.png)
![Lista de contrasenas](docs/screenshots/password-list.png)
![Salud de contrasenas](docs/screenshots/password-health.png)
![Salud de contrasenas 2](docs/screenshots/password-health2.png)
![Generador](docs/screenshots/generator.png)
![Ajustes](docs/screenshots/settings.png)
![Ajustes 2](docs/screenshots/settings2.png)

## Funcionalidades

- Boveda cifrada solo local (AES-256-GCM)
- Deteccion de similitud y reutilizacion de contrasenas
- Analisis y puntuacion de salud de contrasenas
- Historial de versiones por contrasena
- Busqueda y filtros avanzados
- Organizacion por carpetas con drag and drop
- Portapapeles seguro con auto-limpieza y limpieza de historial (Windows en modo best effort)
- Importacion/exportacion cifrada en modo offline
- Auto-actualizaciones via GitHub Releases
- Onboarding interactivo y modo demo
- Interfaz ES / EN

## Seguridad

### Cifrado local

La boveda se cifra en disco con AES-256-GCM.

### Sin dependencia de nube

No requiere sincronizacion cloud obligatoria, ni almacenamiento externo de secretos, ni cuenta.

### Derivacion PBKDF2

La derivacion usa PBKDF2-HMAC-SHA512 (`120000` iteraciones en la implementacion actual).

### Auto-limpieza del portapapeles

Los secretos copiados se limpian tras el timeout solo si el contenido actual sigue coincidiendo con el secreto copiado.

### Proteccion frente a fuerza bruta

El bloqueo maestro aplica retardos progresivos tras intentos fallidos de desbloqueo.

### Checks de integridad de boveda

La app valida estructura de boveda y detecta anomalias/corrupcion de timestamps.

## Instalacion

Descarga binarios desde GitHub Releases:

- Releases: https://github.com/Unax-Zulaika-Fuente/KeyPing/releases
- Windows: instalador `.exe` (NSIS)
- Linux: `AppImage`
- macOS: `.dmg`

## Arquitectura

- **Frontend**: Angular (componentes standalone)
- **Runtime de escritorio**: Electron
- **Puente IPC**: preload seguro (`contextIsolation` activado)
- **Boveda**: archivo local cifrado gestionado por el proceso principal de Electron

Resumen de flujo:

1. La UI solicita acciones a traves del IPC del preload.
2. El proceso principal valida y ejecuta operaciones seguras.
3. El modulo de boveda cifra/descifra almacenamiento local.
4. La UI recibe metadatos saneados y estado de operacion.

## Desarrollo

Requisitos:

- Node.js 20+
- npm 10+

Ejecucion local:

```bash
cd keyping-ui
npm install
npm run dev
```

Comandos utiles:

- `npm run build` -> build de produccion + empaquetado
- `npm run test` -> tests de Angular
- `npm run test:electron` -> tests unitarios de Electron

## Roadmap

- Integraciones opcionales de breach-check (con enfoque de privacidad)
- Mayor cobertura de tests automaticos en IPC/boveda
- Mejor UX de resolucion de conflictos en importacion
- Pipeline de firma y notarizacion en macOS
- Modo portable opcional
- Mas mejoras de accesibilidad y navegacion por teclado

## Contribuir

Se aceptan issues y PRs.

Para reportar bugs, incluye:

- SO y version
- Version de KeyPing
- Pasos de reproduccion
- Comportamiento esperado vs actual

## Licencia

Apache-2.0. Consulta [LICENSE](./LICENSE).

## Autor

Unax Zulaika Fuente

- GitHub: https://github.com/Unax-Zulaika-Fuente
- Proyecto: https://github.com/Unax-Zulaika-Fuente/KeyPing
