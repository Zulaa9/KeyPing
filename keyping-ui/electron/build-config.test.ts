import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('release builds keep the hardening fuses enabled', () => {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
  assert.deepEqual(pkg.build.electronFuses, {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true
  });
});

test('the Linux window identity matches the desktop entry without moving user data', () => {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
  // electron-builder genera KeyPing.desktop con StartupWMClass=KeyPing a partir de productName.
  assert.equal(pkg.build.productName, 'KeyPing');
  assert.equal(pkg.desktopName, `${pkg.build.productName}.desktop`);
  // Cambiar "name" movería %APPDATA%/keyping-ui y ~/.config/keyping-ui: la bóveda dejaría de encontrarse.
  assert.equal(pkg.name, 'keyping-ui');
  assert.ok(pkg.build.extraResources.some((r: { to: string }) => r.to === 'icon.png'));
});
