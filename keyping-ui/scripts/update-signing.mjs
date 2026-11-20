#!/usr/bin/env node
// Firma de los metadatos de actualización de KeyPing (latest.yml / latest-linux.yml).
//
//   node scripts/update-signing.mjs keygen            Genera la clave Ed25519 (una sola vez)
//   node scripts/update-signing.mjs sign <yml>...      Firma los yml (comprueba antes el instalador)
//   node scripts/update-signing.mjs verify <yml>...    Comprueba la firma con las claves de la app
//
// La clave privada se guarda FUERA del repositorio, cifrada con una frase de paso:
//   por defecto ~/.keyping-signing/update-ed25519.pem (cámbiala con KEYPING_UPDATE_KEY).
// La frase se pide por teclado o se toma de KEYPING_UPDATE_KEY_PASSPHRASE.
// sign y verify usan el código compilado de la app (npm run electron:build), para que la
// firma se calcule exactamente igual que la comprobará KeyPing.

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const KEYS_SOURCE = join(ROOT, 'electron', 'updates', 'update-public-keys.ts');
const COMPILED_SIGNATURE = join(ROOT, 'dist-electron', 'electron', 'updates', 'update-signature.js');
const COMPILED_KEYS = join(ROOT, 'dist-electron', 'electron', 'updates', 'update-public-keys.js');
const KEY_PATH = resolve(process.env.KEYPING_UPDATE_KEY || join(homedir(), '.keyping-signing', 'update-ed25519.pem'));
const SIGNED_LINE = /^(keypingSignature|keypingKeyId):.*(\r?\n|$)/gm;

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

// Mismo js-yaml que usa electron-updater para leer el yml en la app.
function loadYaml(text) {
  const yamlPath = require.resolve('js-yaml', { paths: [dirname(require.resolve('electron-updater'))] });
  return require(yamlPath).load(text);
}

function loadCompiled() {
  if (!existsSync(COMPILED_SIGNATURE) || !existsSync(COMPILED_KEYS)) {
    fail('falta el código compilado. Ejecuta antes: npm run electron:build');
  }
  // El compilado debe corresponder a las claves actuales del código fuente.
  if (statSync(COMPILED_KEYS).mtimeMs < statSync(KEYS_SOURCE).mtimeMs) {
    fail('update-public-keys.ts es más reciente que el compilado. Ejecuta: npm run electron:build');
  }
  return { ...require(COMPILED_SIGNATURE), ...require(COMPILED_KEYS) };
}

export function keyIdFor(spkiDer) {
  return createHash('sha256').update(spkiDer).digest('hex').slice(0, 16);
}

function askHidden(question) {
  return new Promise(res => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => {
      if (s.includes(question)) process.stdout.write(s);
    };
    rl.question(question, answer => {
      rl.close();
      process.stdout.write('\n');
      res(answer);
    });
  });
}

async function passphrase(confirm) {
  if (process.env.KEYPING_UPDATE_KEY_PASSPHRASE) return process.env.KEYPING_UPDATE_KEY_PASSPHRASE;
  if (!process.stdin.isTTY) fail('no hay terminal para pedir la frase de paso (usa KEYPING_UPDATE_KEY_PASSPHRASE)');
  const first = await askHidden('Frase de paso de la clave de firma: ');
  if (confirm) {
    if (first.length < 12) fail('usa una frase de paso de al menos 12 caracteres');
    const second = await askHidden('Repítela: ');
    if (first !== second) fail('las frases no coinciden');
  }
  return first;
}

function writePublicKey(keyId, spkiB64) {
  const src = readFileSync(KEYS_SOURCE, 'utf8');
  const start = src.indexOf('// KEYS-START');
  const end = src.indexOf('// KEYS-END');
  if (start < 0 || end < 0) fail(`no encuentro los marcadores KEYS-START/KEYS-END en ${KEYS_SOURCE}`);
  const block = src.slice(start, end);
  if (block.includes(`'${keyId}'`)) return false;
  const line = `  '${keyId}': '${spkiB64}',\n  `;
  writeFileSync(KEYS_SOURCE, src.slice(0, end) + line + src.slice(end));
  return true;
}

async function keygen() {
  if (existsSync(KEY_PATH)) fail(`ya existe una clave en ${KEY_PATH}. No se sobrescribe.`);
  const pass = await passphrase(true);
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  const keyId = keyIdFor(spki);
  const pem = privateKey.export({ format: 'pem', type: 'pkcs8', cipher: 'aes-256-cbc', passphrase: pass });
  mkdirSync(dirname(KEY_PATH), { recursive: true, mode: 0o700 });
  writeFileSync(KEY_PATH, pem, { mode: 0o600, flag: 'wx' });
  writePublicKey(keyId, spki.toString('base64'));
  console.log(`Clave privada (cifrada): ${KEY_PATH}`);
  console.log(`Clave pública añadida a electron/updates/update-public-keys.ts con id ${keyId}`);
  console.log('Haz una copia de la clave privada y de su frase en un lugar seguro FUERA del equipo y de GitHub.');
  console.log('Sin ella no podrás publicar actualizaciones que las versiones instaladas acepten.');
}

async function loadPrivateKey() {
  if (!existsSync(KEY_PATH)) fail(`no encuentro la clave privada en ${KEY_PATH} (KEYPING_UPDATE_KEY)`);
  const pass = await passphrase(false);
  try {
    return createPrivateKey({ key: readFileSync(KEY_PATH, 'utf8'), format: 'pem', passphrase: pass });
  } catch {
    fail('no se pudo abrir la clave privada (¿frase de paso incorrecta?)');
  }
}

function sha512File(file) {
  return createHash('sha512').update(readFileSync(file)).digest('base64');
}

// Antes de firmar, comprueba que los instaladores que describe el yml son los que tienes delante.
function checkLocalFiles(info, ymlPath, files) {
  const dir = dirname(ymlPath);
  for (const f of files) {
    const local = join(dir, basename(String(f.url)));
    if (!existsSync(local)) fail(`falta ${local}: descarga o compila el instalador junto al yml (o usa --no-file-check)`);
    if (f.size !== undefined && statSync(local).size !== f.size) fail(`el tamaño de ${local} no coincide con el yml`);
    if (sha512File(local) !== f.sha512) fail(`el sha512 de ${local} no coincide con el yml`);
  }
  if (info.path && info.sha512 && !files.some(f => f.url === info.path)) {
    const local = join(dir, basename(String(info.path)));
    if (!existsSync(local) || sha512File(local) !== info.sha512) fail(`el sha512 de ${local} no coincide con el yml`);
  }
}

async function signFiles(paths, { fileCheck }) {
  if (paths.length === 0) fail('indica al menos un latest*.yml');
  const { canonicalUpdateMessage, verifyUpdateSignature, UPDATE_PUBLIC_KEYS } = loadCompiled();
  const key = await loadPrivateKey();
  const spki = createPublicKey(key).export({ format: 'der', type: 'spki' });
  const keyId = keyIdFor(spki);
  if (UPDATE_PUBLIC_KEYS[keyId] !== spki.toString('base64')) {
    fail(`la clave ${keyId} no está entre las claves públicas de la app: las instalaciones rechazarían la firma`);
  }
  for (const p of paths) {
    const ymlPath = resolve(p);
    const original = readFileSync(ymlPath, 'utf8');
    const base = original.replace(SIGNED_LINE, '').replace(/\s*$/, '\n');
    const info = loadYaml(base);
    const files = Array.isArray(info?.files) && info.files.length ? info.files : [{ url: info?.path, sha512: info?.sha512 }];
    if (fileCheck) checkLocalFiles(info, ymlPath, files);
    const message = canonicalUpdateMessage(info);
    const signature = sign(null, Buffer.from(message, 'utf8'), key).toString('base64');
    const signed = `${base}keypingKeyId: ${keyId}\nkeypingSignature: ${signature}\n`;
    const check = verifyUpdateSignature(loadYaml(signed), UPDATE_PUBLIC_KEYS);
    if (!check.ok) fail(`la firma de ${ymlPath} no se verifica (${check.reason})`);
    writeFileSync(ymlPath, signed);
    console.log(`Firmado ${ymlPath} (versión ${info.version}, clave ${keyId})`);
  }
}

function verifyFiles(paths) {
  if (paths.length === 0) fail('indica al menos un latest*.yml');
  const { verifyUpdateSignature, UPDATE_PUBLIC_KEYS } = loadCompiled();
  let bad = 0;
  for (const p of paths) {
    const info = loadYaml(readFileSync(resolve(p), 'utf8'));
    const r = verifyUpdateSignature(info, UPDATE_PUBLIC_KEYS);
    console.log(r.ok ? `OK    ${p} (versión ${info.version}, clave ${r.keyId})` : `FALLA ${p}: ${r.reason}`);
    if (!r.ok) bad++;
  }
  process.exit(bad ? 1 : 0);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = rest.filter(a => !a.startsWith('--'));
  const fileCheck = !rest.includes('--no-file-check');
  if (cmd === 'keygen') await keygen();
  else if (cmd === 'sign') await signFiles(args, { fileCheck });
  else if (cmd === 'verify') verifyFiles(args);
  else {
    console.log('Uso: node scripts/update-signing.mjs keygen | sign <latest.yml>... [--no-file-check] | verify <latest.yml>...');
    process.exit(cmd ? 1 : 0);
  }
}
