import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, KeyObject, sign } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { canonicalUpdateMessage, SignableUpdateInfo, verifyUpdateSignature } from './update-signature';
import { UPDATE_PUBLIC_KEYS } from './update-public-keys';

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  const keyId = createHash('sha256').update(spki).digest('hex').slice(0, 16);
  return { keyId, privateKey, keys: { [keyId]: spki.toString('base64') } };
}

const SHA_A = 'A'.repeat(86) + '==';
const SHA_B = 'B'.repeat(86) + '==';

function baseInfo(): SignableUpdateInfo {
  // Forma real de un latest.yml de electron-builder 26 tras js-yaml.
  return {
    version: '1.3.0',
    files: [{ url: 'KeyPing-Setup-1.3.0.exe', sha512: SHA_A, size: 98765432 }],
    path: 'KeyPing-Setup-1.3.0.exe',
    sha512: SHA_A,
    releaseDate: '2026-11-19T10:00:00.000Z'
  };
}

function signInfo(info: SignableUpdateInfo, privateKey: KeyObject, keyId: string): SignableUpdateInfo {
  const keypingSignature = sign(null, Buffer.from(canonicalUpdateMessage(info), 'utf8'), privateKey).toString('base64');
  return { ...info, keypingKeyId: keyId, keypingSignature };
}

test('a correctly signed update is accepted', () => {
  const { keyId, privateKey, keys } = keypair();
  const r = verifyUpdateSignature(signInfo(baseInfo(), privateKey, keyId), keys);
  assert.deepEqual(r, { ok: true, keyId });
});

test('changing the installer hash, size, name or version invalidates the signature', () => {
  const { keyId, privateKey, keys } = keypair();
  const signed = signInfo(baseInfo(), privateKey, keyId);
  const tampered: SignableUpdateInfo[] = [
    { ...signed, files: [{ url: 'KeyPing-Setup-1.3.0.exe', sha512: SHA_B, size: 98765432 }] },
    { ...signed, files: [{ url: 'KeyPing-Setup-1.3.0.exe', sha512: SHA_A, size: 1 }] },
    { ...signed, files: [{ url: 'evil.exe', sha512: SHA_A, size: 98765432 }] },
    { ...signed, files: [...(signed.files as object[]), { url: 'extra.exe', sha512: SHA_B, size: 1 }] },
    { ...signed, version: '9.9.9' },
    { ...signed, path: 'evil.exe' },
    { ...signed, sha512: SHA_B }
  ];
  for (const t of tampered) assert.deepEqual(verifyUpdateSignature(t, keys), { ok: false, reason: 'bad-signature' });
});

test('fields electron-updater ignores (release notes, date) may change without breaking the signature', () => {
  const { keyId, privateKey, keys } = keypair();
  const signed = signInfo(baseInfo(), privateKey, keyId);
  assert.equal(verifyUpdateSignature({ ...signed, releaseDate: 'x', releaseNotes: 'y' }, keys).ok, true);
});

test('unsigned, unknown-key, foreign-key and malformed metadata are rejected (fail-closed)', () => {
  const a = keypair();
  const b = keypair();
  const signedByB = signInfo(baseInfo(), b.privateKey, b.keyId);
  assert.deepEqual(verifyUpdateSignature(baseInfo(), a.keys), { ok: false, reason: 'missing-signature' });
  assert.deepEqual(verifyUpdateSignature(signedByB, a.keys), { ok: false, reason: 'unknown-key' });
  // Firma de otra clave presentada con el id de la clave de confianza.
  assert.deepEqual(verifyUpdateSignature({ ...signedByB, keypingKeyId: a.keyId }, a.keys), { ok: false, reason: 'bad-signature' });
  assert.deepEqual(verifyUpdateSignature({ ...signedByB, keypingSignature: 'AAAA' }, b.keys), { ok: false, reason: 'bad-signature' });
  assert.deepEqual(verifyUpdateSignature(signInfo(baseInfo(), a.privateKey, a.keyId), {}), { ok: false, reason: 'no-trusted-keys' });
  assert.deepEqual(verifyUpdateSignature(null, a.keys), { ok: false, reason: 'invalid-metadata' });
  const noFiles = { version: '1.3.0', keypingKeyId: a.keyId, keypingSignature: 'x' };
  assert.deepEqual(verifyUpdateSignature(noFiles, a.keys), { ok: false, reason: 'invalid-metadata' });
  const injected = { ...signInfo(baseInfo(), a.privateKey, a.keyId), version: '1.3.0\nfile=evil' };
  assert.deepEqual(verifyUpdateSignature(injected, a.keys), { ok: false, reason: 'invalid-metadata' });
  // __proto__ y similares no cuentan como id de clave.
  assert.deepEqual(verifyUpdateSignature({ ...signedByB, keypingKeyId: 'toString' }, a.keys), { ok: false, reason: 'unknown-key' });
});

test('the canonical message is independent of file order and supports old yml without files', () => {
  const two = { version: '1.3.0', files: [{ url: 'b', sha512: SHA_B, size: 2 }, { url: 'a', sha512: SHA_A, size: 1 }] };
  const swapped = { version: '1.3.0', files: [two.files[1], two.files[0]] };
  assert.equal(canonicalUpdateMessage(two), canonicalUpdateMessage(swapped));
  const legacy = { version: '1.0.0', path: 'KeyPing.AppImage', sha512: SHA_A };
  assert.match(canonicalUpdateMessage(legacy), /file=KeyPing\.AppImage\|/);
});

test('the embedded public keys are well-formed Ed25519 SPKI keys with matching ids', () => {
  for (const [id, b64] of Object.entries(UPDATE_PUBLIC_KEYS)) {
    const der = Buffer.from(b64, 'base64');
    assert.equal(createHash('sha256').update(der).digest('hex').slice(0, 16), id);
    assert.equal(require('node:crypto').createPublicKey({ key: der, format: 'der', type: 'spki' }).asymmetricKeyType, 'ed25519');
  }
});

// --- Servicio de actualizaciones con electron y electron-updater simulados -------------------

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowDowngrade = true;
  downloads = 0;
  installs = 0;
  nextInfo: SignableUpdateInfo | null = null;
  async checkForUpdates() {
    if (this.nextInfo) this.emit('update-available', this.nextInfo);
    else this.emit('update-not-available', {});
  }
  async downloadUpdate() {
    this.downloads++;
    if (this.nextInfo) this.emit('update-downloaded', { ...this.nextInfo, downloadedFile: '/tmp/x' });
  }
  quitAndInstall() {
    this.installs++;
  }
}

function loadService(updater: FakeUpdater) {
  const userData = mkdtempSync(path.join(os.tmpdir(), 'kp-upd-'));
  const fakeElectron = {
    app: { getPath: () => userData, getVersion: () => '1.2.1', isPackaged: true },
    ipcMain: { handle: () => undefined },
    BrowserWindow: class {}
  };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Module = require('node:module');
  const original = Module._load;
  Module._load = function (request: string, ...rest: unknown[]) {
    if (request === 'electron') return fakeElectron;
    if (request === 'electron-updater') return { autoUpdater: updater };
    return original.call(this, request, ...rest);
  };
  try {
    const modPath = require.resolve('./auto-update.service');
    delete require.cache[modPath];
    return { mod: require(modPath), userData };
  } finally {
    Module._load = original;
  }
}

async function startService(keys: Record<string, string>) {
  const updater = new FakeUpdater();
  const { mod } = loadService(updater);
  const svc = new mod.AutoUpdateService(() => [], () => true, keys);
  await svc.initialize();
  return { svc, updater };
}

test('service: a signed update can be downloaded and installed', async () => {
  const { keyId, privateKey, keys } = keypair();
  const { svc, updater } = await startService(keys);
  updater.nextInfo = signInfo(baseInfo(), privateKey, keyId);
  await svc.checkForUpdates('manual');
  assert.equal(svc.getState().status, 'available');
  assert.equal(updater.autoInstallOnAppQuit, false, 'no install-on-quit before a verified download');
  await svc.downloadUpdate();
  assert.equal(svc.getState().status, 'downloaded');
  assert.equal(updater.autoInstallOnAppQuit, true);
  assert.equal(svc.installUpdateAndRestart(), true);
  await new Promise(r => setImmediate(r));
  assert.equal(updater.installs, 1);
});

test('service: an unsigned update is blocked before downloading, even at startup', async () => {
  const { keys } = keypair();
  const { svc, updater } = await startService(keys);
  updater.nextInfo = baseInfo();
  await svc.checkForUpdates('startup');
  const st = svc.getState();
  assert.equal(st.status, 'error');
  assert.equal(st.errorCode, 'signature');
  await svc.downloadUpdate();
  assert.equal(updater.downloads, 0, 'download refused');
  assert.equal(svc.installUpdateAndRestart(), false);
  assert.equal(updater.autoInstallOnAppQuit, false);
});

test('service: metadata swapped between check and download is not installed', async () => {
  const { keyId, privateKey, keys } = keypair();
  const { svc, updater } = await startService(keys);
  updater.nextInfo = signInfo(baseInfo(), privateKey, keyId);
  await svc.checkForUpdates('manual');
  // Otra versión, también firmada, que no es la que se verificó al comprobar.
  updater.nextInfo = signInfo({ ...baseInfo(), version: '1.3.1' }, privateKey, keyId);
  await svc.downloadUpdate();
  assert.equal(svc.getState().status, 'error');
  assert.equal(svc.getState().errorCode, 'signature');
  assert.equal(svc.installUpdateAndRestart(), false);
  assert.equal(updater.autoInstallOnAppQuit, false);
});

test('service: with no embedded keys nothing is ever downloaded', async () => {
  const { keyId, privateKey } = keypair();
  const { svc, updater } = await startService({});
  updater.nextInfo = signInfo(baseInfo(), privateKey, keyId);
  await svc.checkForUpdates('manual');
  assert.equal(svc.getState().errorCode, 'signature');
  await svc.downloadUpdate();
  assert.equal(updater.downloads, 0);
});

test('the signature error has es/en texts', () => {
  for (const lang of ['es', 'en']) {
    const file = path.join(process.cwd(), 'src', 'assets', 'i18n', `${lang}.json`);
    const dict = JSON.parse(readFileSync(file, 'utf8'));
    assert.ok(dict['updates.error.summary.signature'], lang);
  }
});

test('packaging is guarded by the update key check', () => {
  const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  assert.equal(pkg.build.beforePack, 'scripts/check-update-key.js');
});
