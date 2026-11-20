// Genera los vectores de compatibilidad con el código de ESCRITORIO compilado (dist-electron-tests).
// Solo datos ficticios y un directorio temporal: nunca toca la bóveda real del equipo.
// Uso: npm run test:electron (compila) && node scripts/gen-export-fixtures.cjs <dir-salida>
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = process.env.KP_DIST || path.join(root, 'dist-electron-tests');
const out = path.resolve(process.argv[2] || path.join(root, 'core', 'tests', 'fixtures'));
const pkg = require(path.join(root, 'package.json'));

const { setDataDirForTests } = require(path.join(dist, 'vault', 'paths.js'));
const crypto = require(path.join(dist, 'vault', 'crypto.js'));
const vault = require(path.join(dist, 'vault', 'index.js'));

const EXPORT_PASSWORD = 'Móvil-Exporta-2026!ñ';

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'keyping-fixtures-'));
  setDataDirForTests(tmp);
  try {
    const { auth, key } = crypto.deriveNewAuth('Maestra-Ficticia-123');
    await crypto.commitAuth(auth);
    crypto.setSessionKey(key);

    const a = await vault.addPasswordToVault('Gato-Azul-77!', {
      label: 'Correo ficticio — Ñandú',
      loginUrl: 'https://mail.example.com/login',
      passwordChangeUrl: 'https://mail.example.com/security/password',
      username: 'usuario.ficticio',
      email: 'ficticio@example.com',
      folder: 'Trabajo/Équipo',
      twoFactorEnabled: true,
      iconName: 'gmail',
      iconSource: 'auto',
      detectedService: 'gmail'
    });
    const a2 = await vault.replacePasswordForEntry(a.id, 'Gato-Azul-78!');
    await vault.replacePasswordForEntry(a2.id, 'Perro-Verde-2026#');

    await vault.addPasswordToVault('日本語パスワード-秘密-1', {
      label: '日本のサービス 🎌',
      loginUrl: 'https://example.jp/ログイン',
      passwordChangeUrl: 'https://example.jp/account/password?lang=ja',
      username: 'たろう',
      folder: 'Ocio',
      iconName: 'steam',
      iconSource: 'manual'
    });
    const c = await vault.addPasswordToVault('Contraseña-Débil', { label: 'Foro sin carpeta', loginUrl: 'http://forum.example.org' });
    await vault.softDeleteEntry(c.id);
    await vault.addPasswordToVault('Solo-Contraseña-9', {});

    fs.mkdirSync(out, { recursive: true });
    const full = await vault.exportVaultWithPassword(EXPORT_PASSWORD, true);
    const current = await vault.exportVaultWithPassword(EXPORT_PASSWORD, false);
    const native = await vault.exportEncryptedVault(true);
    // Mismo contenido que escribe settings.ts al descargar (JSON.stringify(payload)).
    fs.writeFileSync(path.join(out, 'desktop-full-history.kpenc'), JSON.stringify(full));
    fs.writeFileSync(path.join(out, 'desktop-current-only.kpenc'), JSON.stringify(current));
    fs.writeFileSync(path.join(out, 'desktop-native-v1.keyping'),
      JSON.stringify({ format: 'keyping-export-v1', enc: 'native', vault: native.toString('base64') }));

    // Lo que el propio escritorio descifra de cada archivo (referencia campo a campo).
    const expFull = await vault.parseImportPayload(JSON.stringify(full), EXPORT_PASSWORD);
    const expCur = await vault.parseImportPayload(JSON.stringify(current), EXPORT_PASSWORD);
    const vaultData = await vault.getVaultEntries();
    fs.writeFileSync(path.join(out, 'desktop-expected.json'), JSON.stringify({
      generatedBy: `keyping-ui ${pkg.version} (escritorio, dist-electron-tests)`,
      generatedAt: new Date().toISOString(),
      exportPassword: EXPORT_PASSWORD,
      fullHistory: expFull.entries,
      currentOnly: expCur.entries,
      vaultEntryCount: vaultData.length
    }, null, 2));
    console.log(`fixtures -> ${out} (${vaultData.length} entradas en bóveda temporal)`);
  } finally {
    crypto.clearSessionKey();
    setDataDirForTests(null);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
main().catch(err => { console.error(err); process.exit(1); });
