import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLIPBOARD_EXCLUSION_FORMATS,
  WINDOWS_CLIPBOARD_ARGS,
  WINDOWS_CLIPBOARD_SCRIPT,
  writeSecretToWindowsClipboard
} from './windows-clipboard';

test('the helper publishes every format that keeps the secret out of Win+V and the cloud', () => {
  assert.deepEqual([...CLIPBOARD_EXCLUSION_FORMATS], [
    'ExcludeClipboardContentFromMonitorProcessing',
    'CanIncludeInClipboardHistory',
    'CanUploadToCloudClipboard'
  ]);
  for (const format of CLIPBOARD_EXCLUSION_FORMATS) {
    assert.ok(WINDOWS_CLIPBOARD_SCRIPT.includes(`'${format}'`), format);
  }
});

test('the helper never clears the user clipboard history', () => {
  assert.equal(WINDOWS_CLIPBOARD_SCRIPT.includes('ClearHistory'), false);
});

test('the secret travels through stdin and never through the command line', async () => {
  const secret = 'ñandú-Ficticia-ü€-003';
  let seenArgs: readonly string[] = [];
  let seenStdin = '';

  const ok = await writeSecretToWindowsClipboard(secret, async (args, stdin) => {
    seenArgs = args;
    seenStdin = stdin;
    return true;
  });

  const encoded = Buffer.from(secret, 'utf8').toString('base64');
  assert.equal(ok, true);
  assert.equal(seenStdin, `${encoded}\n`);
  assert.deepEqual(seenArgs, WINDOWS_CLIPBOARD_ARGS);
  assert.equal(seenArgs.some(a => a.includes(secret) || a.includes(encoded)), false);
});

test('reports failure when the helper fails or throws', async () => {
  assert.equal(await writeSecretToWindowsClipboard('x', async () => false), false);
  assert.equal(
    await writeSecretToWindowsClipboard('x', async () => {
      throw new Error('spawn failed');
    }),
    false
  );
});
