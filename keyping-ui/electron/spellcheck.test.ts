import test from 'node:test';
import assert from 'node:assert/strict';
import { disableSpellcheckDownloads, SpellcheckSession } from './spellcheck';

function fakeSession(throwOnLanguages = false) {
  const calls: string[] = [];
  const session: SpellcheckSession = {
    setSpellCheckerEnabled: (enable) => { calls.push(`enabled:${enable}`); },
    setSpellCheckerLanguages: (languages) => {
      if (throwOnLanguages) throw new Error('not supported');
      calls.push(`languages:${languages.length}`);
    },
  };
  return { session, calls };
}

test('Linux and Windows: disables the spell checker and clears its languages', () => {
  for (const platform of ['linux', 'win32'] as const) {
    const { session, calls } = fakeSession();
    disableSpellcheckDownloads(session, platform);
    assert.deepEqual(calls, ['enabled:false', 'languages:0']);
  }
});

test('macOS: only disables the spell checker', () => {
  const { session, calls } = fakeSession();
  disableSpellcheckDownloads(session, 'darwin');
  assert.deepEqual(calls, ['enabled:false']);
});

test('a session that rejects the language list does not break start-up', () => {
  const { session, calls } = fakeSession(true);
  assert.doesNotThrow(() => disableSpellcheckDownloads(session, 'linux'));
  assert.deepEqual(calls, ['enabled:false']);
});
