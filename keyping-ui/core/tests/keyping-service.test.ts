// Comportamiento del servicio móvil (mismo contrato que el preload del escritorio).
import test from 'node:test';
import assert from 'node:assert/strict';
import { KeypingService, AUTH_FILE, VAULT_FILE } from '../keyping-service';
import { webCrypto } from '../web-crypto';
import { FakeNative, MemoryStore } from './helpers';

function service(now = () => Date.now()) {
  const store = new MemoryStore();
  const native = new FakeNative();
  return { store, native, svc: new KeypingService('android', store, webCrypto, native, now) };
}

test('setup, lock, unlock and progressive delays', async () => {
  let t = 1_800_000_000_000;
  const { svc, store } = service(() => t);
  assert.equal(await svc.hasVault(), false);
  await assert.rejects(svc.authSetup('corta'));
  assert.deepEqual(await svc.authSetup('Maestra-Movil-123'), { ok: true });
  const auth = JSON.parse((await store.read(AUTH_FILE))!);
  assert.equal(auth.iterations, 600000);
  assert.equal(auth.salt.length, 64);
  await svc.savePassword('Secreto-Uno-1', 'Uno');
  assert.ok(!(await store.read(VAULT_FILE))!.includes('Secreto'));
  await svc.sessionLock();
  assert.deepEqual(await svc.listPasswords(), []);
  await assert.rejects(svc.savePassword('x', 'y'), /Session locked/);
  for (let i = 0; i < 3; i++) assert.deepEqual(await svc.authUnlock('mala'), { ok: false, reason: 'invalid' });
  const fourth = await svc.authUnlock('mala');
  assert.equal(fourth.ok, false);
  assert.equal((fourth as any).reason, 'cooldown');
  assert.equal((fourth as any).remainingMs, 5000);
  assert.equal(((await svc.authUnlock('Maestra-Movil-123')) as any).reason, 'cooldown');
  t += 5001;
  assert.deepEqual(await svc.authUnlock('Maestra-Movil-123'), { ok: true });
  assert.equal((await svc.listPasswords()).length, 1);
  assert.equal((await svc.getMainCooldown()).failedAttempts, 0);
});

test('attempt counter survives a restart', async () => {
  const { svc, store, native } = service();
  await svc.authSetup('Maestra-Movil-123');
  await svc.sessionLock();
  for (let i = 0; i < 4; i++) await svc.authUnlock('mala');
  await new Promise(r => setTimeout(r, 10));
  const again = new KeypingService('android', store, webCrypto, native);
  assert.equal(((await again.authUnlock('Maestra-Movil-123')) as any).reason, 'cooldown');
});

test('change master password re-encrypts the vault', async () => {
  const { svc } = service();
  await svc.authSetup('Maestra-Movil-123');
  await svc.savePassword('Secreto-Uno-1', 'Uno');
  assert.deepEqual(await svc.authChange('Maestra-Movil-123', 'Nueva-Maestra-456'), { ok: true });
  await svc.sessionLock();
  assert.equal((await svc.authUnlock('Maestra-Movil-123') as any).ok, false);
  assert.deepEqual(await svc.authUnlock('Nueva-Maestra-456'), { ok: true });
  const [e] = await svc.listPasswords();
  assert.equal(await svc.getPassword(e.id), 'Secreto-Uno-1');
});

test('entries, history, folders, check, clipboard, links and lock notification', async () => {
  const { svc, native } = service();
  await svc.authSetup('Maestra-Movil-123');
  const a = await svc.savePassword('Gato-Azul-77!', 'Correo', 'mail.example.com', 'https://mail.example.com/pw', 'u', 'u@e.com', 'Trabajo');
  assert.equal(a.loginUrl, 'https://mail.example.com');
  assert.ok(!('secret' in a));
  await assert.rejects(svc.savePassword('x1', 'mal', 'javascript:alert(1)'), /invalid-url/);
  const a2 = await svc.updatePassword(a.id, 'Gato-Azul-78!');
  const moved = await svc.updateMeta(a2.id, 'Correo', a2.loginUrl, a2.passwordChangeUrl, 'u', 'u@e.com', 'Personal');
  assert.equal(moved.folder, 'Personal');
  const hist = await svc.getPasswordHistory(a2.id);
  assert.equal(hist.length, 2);
  await svc.restorePasswordVersion(hist[1].id);
  assert.equal((await svc.getPasswordHistory(a2.id)).length, 3);
  const check = await svc.checkCandidate('Gato-Azul-79!');
  assert.ok(check.codes.some((c: any) => c.code === 'similarHigh'));
  assert.equal((await svc.checkCandidate('password1')).level, 'danger');
  assert.equal(await svc.copyPassword(a2.id), true);
  assert.equal(native.copies.at(-1)!.ttlMs, 20000);
  assert.equal(await svc.openExternal('https://mail.example.com/pw'), true);
  assert.equal(await svc.openExternal('javascript:alert(1)'), false);
  assert.equal(await svc.openExternal('file:///etc/passwd'), false);
  assert.deepEqual(native.opened, ['https://mail.example.com/pw']);
  let locked = 0;
  svc.onSessionLocked(() => locked++);
  svc.lockNow();
  assert.equal(locked, 1);
  assert.equal(native.clipboard, null);
  const integrityLocked = svc.checkVaultIntegrity();
  await assert.rejects(integrityLocked, /Session locked/);
});

test('integrity report and compaction', async () => {
  const { svc } = service();
  await svc.authSetup('Maestra-Movil-123');
  const e = await svc.savePassword('Uno-Uno-1', 'x');
  let cur = e;
  for (let i = 0; i < 4; i++) cur = await svc.updatePassword(cur.id, `Uno-Uno-${i + 2}`);
  const rep = await svc.checkVaultIntegrity();
  assert.equal(rep.status, 'ok');
  assert.equal(rep.entries, 5);
  const res = await svc.compactVault(false, 2);
  assert.equal(res.removed, 3);
  assert.equal((await svc.compactVault(true)).removed, 1);
});

test('merge import with selection keeps the selected history chain', async () => {
  const { svc } = service();
  await svc.authSetup('Maestra-Movil-123');
  const e = await svc.savePassword('Uno-Uno-1', 'x');
  await svc.updatePassword(e.id, 'Uno-Uno-2');
  const file = JSON.stringify((await svc.exportVault('master', 'Exp-1', true)).payload);
  const preview = await svc.parseImport(file, 'Exp-1');
  const idx = preview.entries.findIndex((p: any) => p.active !== false);
  const r = await svc.importVault('merge', [{ idx, label: 'Copia' }]);
  assert.equal(r.imported, 1);
  assert.equal((await svc.listPasswords()).length, 2);
});
