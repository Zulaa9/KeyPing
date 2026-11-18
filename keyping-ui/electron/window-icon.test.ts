import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { getLinuxWindowIcon } from './window-icon';

test('the packaged Linux app uses the bundled icon', () => {
  const resourcesPath = join('opt', 'keyping', 'resources');
  assert.equal(
    getLinuxWindowIcon({ platform: 'linux', isPackaged: true, resourcesPath }),
    join(resourcesPath, 'icon.png')
  );
});

test('other platforms and development runs keep their default icon', () => {
  const resourcesPath = 'resources';
  assert.equal(getLinuxWindowIcon({ platform: 'win32', isPackaged: true, resourcesPath }), undefined);
  assert.equal(getLinuxWindowIcon({ platform: 'darwin', isPackaged: true, resourcesPath }), undefined);
  assert.equal(getLinuxWindowIcon({ platform: 'linux', isPackaged: false, resourcesPath }), undefined);
});
