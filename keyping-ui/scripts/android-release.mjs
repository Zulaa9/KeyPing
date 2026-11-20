// APK de publicación firmado con TU clave de subida (nunca la de depuración) → dist/build/KeyPing-<versión>.apk.
// Requiere KEYPING_ANDROID_KEYSTORE, KEYPING_ANDROID_STORE_PASSWORD, KEYPING_ANDROID_KEY_ALIAS y
// KEYPING_ANDROID_KEY_PASSWORD. Después: scripts/generate-checksums.(sh|ps1) para añadirlo a SHA256SUMS.txt.
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vars = ['KEYPING_ANDROID_KEYSTORE', 'KEYPING_ANDROID_STORE_PASSWORD', 'KEYPING_ANDROID_KEY_ALIAS', 'KEYPING_ANDROID_KEY_PASSWORD'];
const missing = vars.filter(v => !process.env[v]);
if (missing.length) {
  console.error(`Faltan variables de firma: ${missing.join(', ')}. Sin ellas el APK saldría sin firmar.`);
  process.exit(1);
}
if (!existsSync(process.env.KEYPING_ANDROID_KEYSTORE)) {
  console.error(`No existe el keystore: ${process.env.KEYPING_ANDROID_KEYSTORE}`);
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const win = process.platform === 'win32';
// Órdenes fijas, sin datos externos: se pasan como una sola línea al shell (en Windows hace falta para .bat/.cmd).
const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });

run('npm run build:mobile', root);
run(win ? 'gradlew.bat assembleRelease' : './gradlew assembleRelease', join(root, 'android'));

const src = join(root, 'android/app/build/outputs/apk/release/app-release.apk');
if (!existsSync(src)) {
  console.error(`No se generó ${src} (¿salió app-release-unsigned.apk? revisa la firma).`);
  process.exit(1);
}
const outDir = join(root, 'dist/build');
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `KeyPing-${version}.apk`);
copyFileSync(src, out);
console.log(`APK firmado: ${out}`);
