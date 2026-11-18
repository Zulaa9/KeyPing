// Hook beforePack de electron-builder: impide empaquetar una versión sin clave pública de
// actualizaciones. Sin ella, la app rechazaría todas las actualizaciones futuras (fail-closed)
// y los usuarios se quedarían sin parches hasta reinstalar a mano.
// Para una compilación de pruebas local: KEYPING_ALLOW_NO_UPDATE_KEY=1.
const { existsSync } = require('node:fs');
const { join } = require('node:path');

exports.default = async function checkUpdateKey() {
  const compiled = join(__dirname, '..', 'dist-electron', 'updates', 'update-public-keys.js');
  if (!existsSync(compiled)) throw new Error('Falta dist-electron: ejecuta npm run electron:build antes de empaquetar.');
  delete require.cache[require.resolve(compiled)];
  const { UPDATE_PUBLIC_KEYS } = require(compiled);
  const ids = Object.keys(UPDATE_PUBLIC_KEYS || {});
  if (ids.length > 0) {
    console.log(`  • claves de firma de actualizaciones: ${ids.join(', ')}`);
    return;
  }
  if (process.env.KEYPING_ALLOW_NO_UPDATE_KEY === '1') {
    console.warn('  • AVISO: compilación SIN clave de actualizaciones; esta build nunca aceptará actualizaciones.');
    return;
  }
  throw new Error(
    'No hay ninguna clave pública en electron/updates/update-public-keys.ts. ' +
      'Genera la clave con "npm run update:keygen" y recompila (o KEYPING_ALLOW_NO_UPDATE_KEY=1 para pruebas).'
  );
};
