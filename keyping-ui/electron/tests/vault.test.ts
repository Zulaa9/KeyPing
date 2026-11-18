import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs, readFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomBytes, pbkdf2Sync, createCipheriv, createHash } from 'crypto';

import { setDataDirForTests } from '../vault/paths';
import {
  setSessionKey,
  clearSessionKey,
  deriveNewAuth,
  commitAuth,
  verifyPasswordAndDeriveKey,
  verifyLegacyRendererCheck,
  encryptWithKey,
  decryptWithKey,
  deriveLegacyMasterKey,
  hasAuthFile,
} from '../vault/crypto';
import {
  loadVault,
  saveVault,
  vaultPath,
  pendingVaultPath,
  writePendingVault,
  recoverPendingVault,
  loadVaultWithKey,
  VaultUnreadableError,
} from '../vault/file';
import {
  addPasswordToVault,
  replacePasswordForEntry,
  getPasswordHistory,
  mergeVaultEntries,
  overwriteVaultWithEntries,
  mapImportedEntries,
  parseImportPayload,
  exportVaultWithPassword,
  runStartupMigrations,
  restorePasswordVersion,
  deleteHistoryVersion,
  updateEntryMeta,
  getVaultEntries,
} from '../vault';
import { atomicWriteFile, withVaultLock } from '../vault/fsutil';

let dir = '';

async function freshSession(password = 'correct horse battery'): Promise<Buffer> {
  const { auth, key } = deriveNewAuth(password);
  await commitAuth(auth);
  setSessionKey(key);
  return key;
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'keyping-test-'));
  setDataDirForTests(dir);
  clearSessionKey();
});

afterEach(async () => {
  clearSessionKey();
  setDataDirForTests(null);
  await fs.rm(dir, { recursive: true, force: true });
});

test('loadVault returns empty only when the file does not exist', async () => {
  await freshSession();
  assert.deepEqual((await loadVault()).entries, []);
});

test('loadVault throws (never returns empty) when the vault cannot be decrypted', async () => {
  await freshSession();
  await addPasswordToVault('Secret-One-123', { label: 'GitHub' });
  // Otra clave de sesión (p. ej. kp-auth.json reemplazado): antes devolvía [] y el siguiente guardado borraba todo.
  setSessionKey(randomBytes(32));
  await assert.rejects(loadVault(), (err: any) => err instanceof VaultUnreadableError && err.reason === 'decrypt-failed');
  await assert.rejects(addPasswordToVault('Another-Secret-9', { label: 'X' }));
  // El archivo original sigue intacto.
  const before = readFileSync(vaultPath());
  assert.ok(before.length > 28);
});

test('loadVault throws on truncated or corrupted files', async () => {
  const key = await freshSession();
  await addPasswordToVault('Secret-One-123', { label: 'GitHub' });
  const buf = await fs.readFile(vaultPath());
  await fs.writeFile(vaultPath(), buf.subarray(0, 20));
  await assert.rejects(loadVault(), (err: any) => err?.reason === 'too-short');
  const corrupted = Buffer.from(buf);
  corrupted[corrupted.length - 1] ^= 0xff;
  await fs.writeFile(vaultPath(), corrupted);
  await assert.rejects(loadVault(), (err: any) => err?.reason === 'decrypt-failed');
  await fs.writeFile(vaultPath(), encryptWithKey('{not json', key));
  await assert.rejects(loadVault(), (err: any) => err?.reason === 'invalid-json');
  await fs.writeFile(vaultPath(), encryptWithKey('{"foo":1}', key));
  await assert.rejects(loadVault(), (err: any) => err?.reason === 'invalid-structure');
});

test('concurrent mutations are serialized and none is lost', async () => {
  await freshSession();
  await Promise.all(
    Array.from({ length: 25 }, (_, i) => addPasswordToVault(`Pw-${i}-abcdefgh`, { label: `E${i}` }))
  );
  const entries = await getVaultEntries();
  assert.equal(entries.length, 25);
  const leftovers = (await fs.readdir(dir)).filter(n => n.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
});

test('withVaultLock keeps running after a failing task', async () => {
  const order: number[] = [];
  await assert.rejects(withVaultLock(async () => { order.push(1); throw new Error('boom'); }));
  await withVaultLock(async () => { order.push(2); });
  assert.deepEqual(order, [1, 2]);
});

test('atomicWriteFile replaces content without leaving temporaries', async () => {
  const file = path.join(dir, 'a.json');
  await atomicWriteFile(file, 'one');
  await atomicWriteFile(file, 'two');
  assert.equal(await fs.readFile(file, 'utf8'), 'two');
  assert.deepEqual((await fs.readdir(dir)).sort(), ['a.json']);
});

test('nonces are unique and GCM tag is verified', () => {
  const key = randomBytes(32);
  const a = encryptWithKey('same text', key);
  const b = encryptWithKey('same text', key);
  assert.notDeepEqual(a.subarray(0, 12), b.subarray(0, 12));
  assert.equal(decryptWithKey(a, key), 'same text');
  const tampered = Buffer.from(a);
  tampered[14] ^= 1; // dentro de la etiqueta
  assert.throws(() => decryptWithKey(tampered, key));
});

test('auth: correct password derives the key, wrong one does not', async () => {
  const key = await freshSession('my master pass');
  const ok = await verifyPasswordAndDeriveKey('my master pass');
  assert.ok(ok && ok.equals(key));
  assert.equal(await verifyPasswordAndDeriveKey('wrong'), null);
});

test('auth: out-of-range iterations in kp-auth.json are clamped', async () => {
  const salt = randomBytes(32);
  const key = pbkdf2Sync('pw-iter', salt, 100_000, 32, 'sha512');
  const nonce = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, nonce);
  const ct = Buffer.concat([c.update('keyping-master-check', 'utf8'), c.final()]);
  const check = Buffer.concat([nonce, c.getAuthTag(), ct]).toString('hex');
  // 1 iteración en disco: se fuerza el mínimo (100k) en lugar de aceptar una derivación débil.
  await fs.writeFile(path.join(dir, 'kp-auth.json'), JSON.stringify({ salt: salt.toString('hex'), iterations: 1, check }));
  assert.ok(await verifyPasswordAndDeriveKey('pw-iter'));
});

test('legacy renderer verifier (1.0.x localStorage) is checked correctly', async () => {
  // Reproduce lo que hacía WebCrypto en 1.0.x: PBKDF2-SHA256 150k, AES-GCM iv||ct||tag en base64.
  const password = 'legacy-pass-1';
  const salt = randomBytes(16);
  const key = pbkdf2Sync(password, salt, 150_000, 32, 'sha256');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update('keyping-master-check', 'utf8'), c.final()]);
  const stored = {
    salt: salt.toString('base64'),
    check: Buffer.concat([iv, ct, c.getAuthTag()]).toString('base64'),
    iterations: 150_000
  };
  assert.equal(verifyLegacyRendererCheck(password, stored), true);
  assert.equal(verifyLegacyRendererCheck('typo-pass-1', stored), false);
  assert.equal(verifyLegacyRendererCheck(password, null), null);
  assert.equal(verifyLegacyRendererCheck(password, { salt: 'x' }), null);
});

test('replacing a password keeps the previous one in history; same password creates no version', async () => {
  await freshSession();
  const e = await addPasswordToVault('Old-Password-1', {
    label: 'GitHub', loginUrl: 'github.com/login', passwordChangeUrl: 'https://github.com/settings/security'
  });
  assert.equal(e.loginUrl, 'https://github.com/login');
  const same = await replacePasswordForEntry(e.id, 'Old-Password-1');
  assert.equal(same?.id, e.id);
  const next = await replacePasswordForEntry(e.id, 'New-Password-2');
  assert.ok(next && next.id !== e.id);
  const history = await getPasswordHistory(next!.id);
  assert.deepEqual(history.map(h => h.secret), ['New-Password-2', 'Old-Password-1']);
  assert.equal(history[0].passwordChangeUrl, 'https://github.com/settings/security');
  // Editar desde una versión antigua no crea ramas: sigue la cadena hasta la más reciente.
  const third = await replacePasswordForEntry(e.id, 'Third-Password-3');
  assert.equal(third?.previousId, next!.id);
});

test('restoring a version keeps current links and deleting a middle version keeps the chain', async () => {
  await freshSession();
  const v1 = await addPasswordToVault('Pass-v1-aaaa', { label: 'Mail' });
  const v2 = (await replacePasswordForEntry(v1.id, 'Pass-v2-bbbb'))!;
  const v3 = (await replacePasswordForEntry(v2.id, 'Pass-v3-cccc'))!;
  await updateEntryMeta(v3.id, { passwordChangeUrl: 'mail.example.com/security' });
  const restored = (await restorePasswordVersion(v1.id))!;
  assert.equal(restored.secret, 'Pass-v1-aaaa');
  assert.equal(restored.passwordChangeUrl, 'https://mail.example.com/security');
  await deleteHistoryVersion(v2.id);
  const chain = await getPasswordHistory(restored.id);
  assert.deepEqual(chain.map(c => c.secret), ['Pass-v1-aaaa', 'Pass-v3-cccc', 'Pass-v1-aaaa']);
});

test('dangerous links are rejected when saving', async () => {
  await freshSession();
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', '\\\\server\\share', 'C:\\Windows', 'https://user:pw@evil.com']) {
    await assert.rejects(addPasswordToVault('Pw-abcdefgh-1', { loginUrl: bad }), /invalid-url/, bad);
  }
});

test('merge import re-links history inside the batch and never points at existing entries', async () => {
  await freshSession();
  const existing = await addPasswordToVault('Existing-Pw-1', { label: 'Existing' });
  const batch = [
    { id: existing.id, label: 'Imported current', password: 'Imp-2', previousId: 'old-1', active: true },
    { id: 'old-1', label: 'Imported old', password: 'Imp-1', active: false },
    { id: 'x', label: 'Bad link', password: 'Imp-3', loginUrl: 'javascript:alert(1)' },
    { label: 'No password' }
  ];
  const count = await mergeVaultEntries(batch as any);
  assert.equal(count, 2);
  const all = await getVaultEntries();
  assert.equal(all.length, 4);
  const imported = all.find(e => e.label === 'Imported current')!;
  assert.notEqual(imported.id, existing.id);
  const old = all.find(e => e.label === 'Imported old')!;
  assert.equal(imported.previousId, old.id);
  assert.equal(all.find(e => e.label === 'Bad link')!.loginUrl, undefined);
  // La entrada existente no ha cambiado.
  assert.equal(all.find(e => e.id === existing.id)!.secret, 'Existing-Pw-1');
});

test('export with password and overwrite import round-trips entries, history, folders and links', async () => {
  await freshSession();
  const a = await addPasswordToVault('A-pass-1111', {
    label: 'Bank', folder: 'Finanzas', loginUrl: 'https://bank.example/login',
    passwordChangeUrl: 'https://bank.example/pw', username: 'ana', email: 'ana@example.com',
    twoFactorEnabled: true, iconName: 'generic', iconSource: 'auto'
  });
  await replacePasswordForEntry(a.id, 'A-pass-2222');
  const before = await getVaultEntries();
  const payload = await exportVaultWithPassword('export-pass', true);
  const parsed = await parseImportPayload(JSON.stringify(payload), 'export-pass');
  await assert.rejects(parseImportPayload(JSON.stringify(payload), 'wrong-pass'), /import-wrong-password/);
  await overwriteVaultWithEntries(parsed.entries);
  const after = await getVaultEntries();
  const pick = (list: any[]) => list.map(e => ({
    id: e.id, secret: e.secret, previousId: e.previousId, active: e.active, folder: e.folder,
    loginUrl: e.loginUrl, passwordChangeUrl: e.passwordChangeUrl, username: e.username, email: e.email,
    twoFactorEnabled: e.twoFactorEnabled, label: e.label
  }));
  assert.deepEqual(pick(after), pick(before));
});

test('malformed import files are rejected with a clear code', async () => {
  await freshSession();
  await assert.rejects(parseImportPayload('not json'), /invalid-import-file/);
  await assert.rejects(parseImportPayload('{"format":"keyping-export-v2","enc":"master"}', 'x'), /invalid-import-file/);
  await assert.rejects(parseImportPayload('{"hello":1}'), /invalid-import-file/);
  const plain = await parseImportPayload(JSON.stringify([{ label: 'a', password: 'b' }, null, 5]));
  assert.equal(plain.entries.length, 1);
});

test('mapImportedEntries recomputes derived fields instead of trusting the file', async () => {
  const key = randomBytes(32);
  const [e] = mapImportedEntries([{ id: 'a', password: 'abc', length: 999, classMask: 0, hash: 'fake' } as any], key, { keepIds: true });
  assert.equal(e.length, 3);
  assert.equal(e.classMask, 1);
  assert.notEqual(e.hash, 'fake');
});

test('startup migration converts legacy SHA-256 hashes and the duplicate password field without losing secrets', async () => {
  const key = await freshSession();
  const legacy = {
    entries: [
      { id: '1', createdAt: 1_700_000_000_000, length: 9, classMask: 5, hash: createHash('sha256').update('legacy-01').digest('hex'), secret: 'legacy-01', password: 'legacy-01', note: 'Old note' },
      { id: '2', createdAt: 1_700_000_000_000, length: 9, classMask: 5, hash: 'x', password: 'only-pass' }
    ]
  };
  await fs.writeFile(vaultPath(), encryptWithKey(JSON.stringify(legacy), key));
  await runStartupMigrations();
  const v1 = await loadVault();
  await runStartupMigrations();
  const v2 = await loadVault();
  assert.equal(v1.hashVersion, 'hmac-sha256-v1');
  assert.deepEqual(v2, v1); // idempotente
  assert.equal(v1.entries[0].secret, 'legacy-01');
  assert.equal(v1.entries[0].label, 'Old note');
  assert.equal((v1.entries[0] as any).password, undefined);
  assert.equal(v1.entries[1].secret, 'only-pass');
});

test('pending vault from an interrupted password change is promoted when its auth was committed', async () => {
  await freshSession('old-password');
  await addPasswordToVault('Keep-Me-123', { label: 'Keep' });
  const vault = await loadVault();
  const { auth, key } = deriveNewAuth('new-password');
  await writePendingVault(vault, key);
  await commitAuth(auth);
  // Corte antes de renombrar: el vault principal sigue con la clave antigua.
  const newKey = (await verifyPasswordAndDeriveKey('new-password'))!;
  assert.equal(await recoverPendingVault(newKey), 'promoted');
  const recovered = await loadVaultWithKey(newKey);
  assert.equal(recovered.entries[0].secret, 'Keep-Me-123');
  assert.equal(await recoverPendingVault(newKey), 'none');
});

test('pending vault whose auth never landed is discarded and the old vault keeps working', async () => {
  const oldKey = await freshSession('old-password');
  await addPasswordToVault('Keep-Me-123', { label: 'Keep' });
  const { key } = deriveNewAuth('new-password');
  await writePendingVault(await loadVault(), key);
  assert.equal(await recoverPendingVault(oldKey), 'discarded');
  await assert.rejects(fs.access(pendingVaultPath()));
  assert.equal((await loadVaultWithKey(oldKey)).entries[0].secret, 'Keep-Me-123');
});

test('legacy kp-master.key derives the same key as 1.0.x', async () => {
  const base = randomBytes(32);
  const salt = randomBytes(16);
  await fs.writeFile(path.join(dir, 'kp-master.key'), JSON.stringify({ base: base.toString('hex'), salt: salt.toString('hex') }));
  const expected = pbkdf2Sync(base, salt, 120_000, 32, 'sha512');
  const k = await deriveLegacyMasterKey();
  assert.ok(k && k.equals(expected));
  assert.equal(await hasAuthFile(), false);
});

test('saving a vault never needs to read the previous one (no secrets in errors)', async () => {
  await freshSession();
  await saveVault({ entries: [] });
  try {
    setSessionKey(randomBytes(32));
    await loadVault();
    assert.fail('should throw');
  } catch (err: any) {
    assert.ok(!String(err.message).includes('Secret'));
  }
});
