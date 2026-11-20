// Una bóveda creada por el escritorio 1.3.1 sin modificar se abre igual con el escritorio actual.
// Solo se ejecuta con KP_BASELINE_DIST apuntando a la compilación 1.3.1 (dist-electron de esa versión).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ROOT } from './helpers';

const baseline = process.env.KP_BASELINE_DIST;

function load(dist: string) {
  const base = existsSync(path.join(dist, 'electron', 'vault')) ? path.join(dist, 'electron', 'vault') : path.join(dist, 'vault');
  const req = (m: string) => {
    const p = path.join(base, m);
    delete require.cache[require.resolve(p)];
    return require(p);
  };
  return { paths: req('paths.js'), crypto: req('crypto.js'), vault: req('index.js'), file: req('file.js') };
}

test('vault written by desktop 1.3.1 opens unchanged with the current desktop code', { skip: !baseline && 'KP_BASELINE_DIST no definido' }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'keyping-baseline-'));
  try {
    const old = load(baseline!);
    old.paths.setDataDirForTests(dir);
    const { auth, key } = old.crypto.deriveNewAuth('Maestra-1.3.1');
    await old.crypto.commitAuth(auth);
    old.crypto.setSessionKey(key);
    const a = await old.vault.addPasswordToVault('Vieja-Uno-1!', { label: 'Antigua ñ', folder: 'F', passwordChangeUrl: 'https://x.example.com/pw' });
    await old.vault.replacePasswordForEntry(a.id, 'Vieja-Dos-2!');
    await old.vault.runStartupMigrations();
    const before = await old.vault.getVaultEntries();
    old.crypto.clearSessionKey();
    old.paths.setDataDirForTests(null);

    const cur = load(path.join(ROOT, 'dist-electron'));
    cur.paths.setDataDirForTests(dir);
    const k = await cur.crypto.verifyPasswordAndDeriveKey('Maestra-1.3.1');
    assert.ok(k, 'la contraseña maestra sigue abriendo la bóveda');
    cur.crypto.setSessionKey(k);
    await cur.vault.runStartupMigrations();
    const after = await cur.vault.getVaultEntries();
    assert.deepEqual(after, before);
    assert.equal((await cur.vault.getPasswordHistory(after.find((e: any) => e.active !== false).id)).length, 2);
    const report = await cur.vault.checkVaultIntegrity();
    assert.equal(report.status, 'ok');
    cur.crypto.clearSessionKey();
    cur.paths.setDataDirForTests(null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
