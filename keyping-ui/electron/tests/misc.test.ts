import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs, readFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { checkEntryUrl, safeExternalHref, normalizeStoredUrl } from '../url-utils';
import { AttemptGuard, clampPolicy, cooldownFor, MAX_COOLDOWN_MS, DEFAULT_POLICY } from '../auth-attempts';
import { setDataDirForTests } from '../vault/paths';
import { ClipboardClearSessionManager } from '../clipboard-clear-session';

test('URL normalization adds https, lowercases the host and keeps the path', () => {
  const cases: [string, string][] = [
    ['github.com/settings/security', 'https://github.com/settings/security'],
    ['  HTTPS://Accounts.Google.COM/Signin?Continue=X  ', 'https://accounts.google.com/Signin?Continue=X'],
    ['http://intranet.local/login', 'http://intranet.local/login'],
    ['localhost:8080/admin', 'https://localhost:8080/admin'],
    ['example.com:8443', 'https://example.com:8443'],
    ['//cdn.example.com/x', 'https://cdn.example.com/x'],
    ['münchen.de/konto', 'https://münchen.de/konto']
  ];
  for (const [input, expected] of cases) {
    const res = checkEntryUrl(input);
    assert.ok(res.ok, input);
    assert.equal(res.ok && res.value, expected, input);
  }
  const idn = checkEntryUrl('münchen.de/konto');
  assert.ok(idn.ok && idn.href === 'https://xn--mnchen-3ya.de/konto' && idn.host === 'xn--mnchen-3ya.de');
});

test('URL validation rejects dangerous schemes, local paths and embedded credentials', () => {
  const bad = [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html;base64,AAAA', 'file:///C:/Windows/system32',
    'file://server/share', '\\\\server\\share\\x', 'C:\\Users\\me', 'c:/temp', '/etc/passwd', 'mailto:a@b.c',
    'ftp://example.com', 'chrome://settings', 'https://user:pass@example.com', 'https://exa mple.com',
    'vbscript:msgbox', 'about:blank', 'https://'
  ];
  for (const input of bad) {
    assert.equal(checkEntryUrl(input).ok, false, input);
    assert.equal(safeExternalHref(input), null, input);
  }
  assert.equal(checkEntryUrl('x'.repeat(3000)).ok, false);
  assert.throws(() => normalizeStoredUrl('javascript:alert(1)'), /invalid-url/);
  assert.equal(normalizeStoredUrl(''), '');
  assert.equal(normalizeStoredUrl(undefined), undefined);
});

test('renderer copy of url-utils is identical to the main-process one', () => {
  const root = path.resolve(__dirname, '..', '..');
  const main = readFileSync(path.join(root, 'electron', 'url-utils.ts'), 'utf8');
  const renderer = readFileSync(path.join(root, 'src', 'app', 'core', 'url-utils.ts'), 'utf8');
  assert.equal(renderer, main);
});

test('attempt policy can only be made stricter than the default', () => {
  const loose = clampPolicy({ freeAttempts: 10, baseDelayMs: 1, growthFactor: 1 });
  assert.deepEqual(loose, DEFAULT_POLICY);
  const strict = clampPolicy({ freeAttempts: 1, baseDelayMs: 30_000, growthFactor: 3 });
  assert.deepEqual(strict, { freeAttempts: 1, baseDelayMs: 30_000, growthFactor: 3 });
  assert.equal(cooldownFor(3, DEFAULT_POLICY), 0);
  assert.equal(cooldownFor(4, DEFAULT_POLICY), 5_000);
  assert.equal(cooldownFor(6, DEFAULT_POLICY), 20_000);
  assert.equal(cooldownFor(100, DEFAULT_POLICY), MAX_COOLDOWN_MS);
});

test('failed attempts and cooldown survive a restart (persisted to disk)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'keyping-attempts-'));
  setDataDirForTests(dir);
  try {
    let now = 1_000_000;
    const g1 = new AttemptGuard(() => now);
    await g1.load();
    for (let i = 0; i < 4; i++) g1.recordFailure();
    assert.equal(g1.remainingMs(), 5_000);
    await g1.flush();

    const g2 = new AttemptGuard(() => now);
    await g2.load();
    assert.equal(g2.isCoolingDown(), true);
    assert.equal(g2.snapshot().failedAttempts, 4);
    now += 5_001;
    assert.equal(g2.isCoolingDown(), false);
    await g2.reset();

    const g3 = new AttemptGuard(() => now);
    await g3.load();
    assert.equal(g3.snapshot().failedAttempts, 0);

    // Un archivo manipulado no puede bloquear más que el tope.
    await fs.writeFile(path.join(dir, 'kp-attempts.json'), JSON.stringify({ failedAttempts: 50, nextUnlockAt: now + 10 * MAX_COOLDOWN_MS }));
    const g4 = new AttemptGuard(() => now);
    await g4.load();
    assert.ok(g4.remainingMs() <= MAX_COOLDOWN_MS);
  } finally {
    setDataDirForTests(null);
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('clipboard is cleared immediately on lock only if it still holds the copied secret', async () => {
  let clip = '';
  let clears = 0;
  const mgr = new ClipboardClearSessionManager({
    readClipboardText: () => clip,
    clearClipboard: () => { clip = ''; clears++; },
    schedule: () => setTimeout(() => {}, 0),
    cancel: h => clearTimeout(h)
  });
  clip = 'secret-1';
  mgr.startSession('secret-1', 20_000);
  assert.equal(await mgr.clearNowIfOwned(), true);
  assert.equal(clip, '');
  clip = 'secret-2';
  mgr.startSession('secret-2', 20_000);
  clip = 'something the user copied later';
  assert.equal(await mgr.clearNowIfOwned(), false);
  assert.equal(clip, 'something the user copied later');
  assert.equal(clears, 1);
  assert.equal(await mgr.clearNowIfOwned(), false);
});
