# KeyPing

[English](./README.md) | [Espanol](./README.es.md)

**KeyPing is a privacy-first desktop password manager that keeps everything local and helps you avoid weak, reused, or overly similar passwords.**

[![Release](https://img.shields.io/github/v/release/Unax-Zulaika-Fuente/KeyPing?label=release)](https://github.com/Unax-Zulaika-Fuente/KeyPing/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-0f172a)](https://github.com/Unax-Zulaika-Fuente/KeyPing/releases)
[![Stack](https://img.shields.io/badge/stack-Angular%20%2B%20Electron-2563eb)](./keyping-ui)
[![License](https://img.shields.io/badge/license-Apache--2.0-green)](./LICENSE)

## Project Status

Active development. Core features are stable and used daily, with continuous improvements in UX, security, and test coverage.

## Screenshots

Add these files under `docs/screenshots/`:

- `dashboard.png`
- `password-list.png`
- `password-health.png`
- `password-health2.png`
- `generator.png`
- `settings.png`
- `settings2.png`

Rendered preview:

![Dashboard](docs/screenshots/dashboard.png)
![Password List](docs/screenshots/password-list.png)
![Password Health](docs/screenshots/password-health.png)
![Password Health 2](docs/screenshots/password-health2.png)
![Generator](docs/screenshots/generator.png)
![Settings](docs/screenshots/settings.png)
![Settings 2](docs/screenshots/settings2.png)

## Features

- Local-only encrypted vault (AES-256-GCM)
- Password similarity and reuse detection
- Password health analysis and scoring
- Version history per password
- Advanced filtering and search
- Folder organization with drag and drop
- Secure clipboard with auto-wipe and history cleaning (Windows best effort)
- Offline encrypted import/export
- Auto-updates via GitHub Releases
- Interactive onboarding and demo mode
- ES / EN interface

## Security

### Local encryption

Vault data is encrypted on disk using AES-256-GCM.

### No cloud dependency

No mandatory cloud sync, no external secret storage, and no account required.

### PBKDF2 key derivation

Key derivation uses PBKDF2-HMAC-SHA512 (`120000` iterations in the current implementation).

### Clipboard auto-clear

Copied secrets are cleared after timeout only if clipboard content still matches the copied secret.

### Brute-force delay protection

Master lock applies escalating cooldown delays after failed unlock attempts.

### Vault integrity checks

The app validates vault structure and detects corruption/timestamp anomalies.

## Installation

Download binaries from GitHub Releases:

- Releases: https://github.com/Unax-Zulaika-Fuente/KeyPing/releases
- Windows: `.exe` installer (NSIS)
- Linux: `AppImage`
- macOS: `.dmg`

## Architecture

- **Frontend**: Angular (standalone components)
- **Desktop runtime**: Electron
- **IPC bridge**: secure preload API (`contextIsolation` enabled)
- **Vault**: encrypted local file managed by Electron main process

Flow summary:

1. UI requests an action through preload IPC.
2. Main process validates and executes secure operations.
3. Vault module encrypts/decrypts local storage.
4. UI receives sanitized metadata and operation state.

## Development

Requirements:

- Node.js 20+
- npm 10+

Run locally:

```bash
cd keyping-ui
npm install
npm run dev
```

Useful commands:

- `npm run build` -> production build + packaging
- `npm run test` -> Angular tests
- `npm run test:electron` -> Electron unit tests

## Roadmap

- Optional breach-check integrations (privacy-preserving approach)
- Expanded IPC/vault automated tests
- Better import conflict resolution UX
- Signed and notarized macOS pipeline
- Optional portable mode
- More accessibility and keyboard navigation polish

## Contributing

Issues and PRs are welcome.

When reporting bugs, include:

- OS and version
- KeyPing version
- Reproduction steps
- Expected vs actual behavior

## License

Apache-2.0. See [LICENSE](./LICENSE).

## Author

Unax Zulaika Fuente

- GitHub: https://github.com/Unax-Zulaika-Fuente
- Project: https://github.com/Unax-Zulaika-Fuente/KeyPing
