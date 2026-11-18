import { createPublicKey, verify } from 'node:crypto';

// Firma propia de los metadatos de actualización (latest.yml / latest-linux.yml).
// electron-updater ya comprueba el sha512 del instalador contra el yml, pero el yml
// viaja sin firmar: quien controle la publicación podría servir otro instalador con su
// propio sha512. Aquí se exige que versión + lista de archivos (url, sha512, tamaño)
// estén firmados con una clave Ed25519 cuya parte pública va dentro de la app.

export const SIGNATURE_FIELD = 'keypingSignature';
export const KEY_ID_FIELD = 'keypingKeyId';
const MESSAGE_HEADER = 'keyping-update-v1';

export interface SignableFile {
  url?: unknown;
  sha512?: unknown;
  size?: unknown;
}

export interface SignableUpdateInfo {
  version?: unknown;
  files?: unknown;
  path?: unknown;
  sha512?: unknown;
  [key: string]: unknown;
}

export type SignatureFailure =
  | 'no-trusted-keys'
  | 'missing-signature'
  | 'unknown-key'
  | 'invalid-metadata'
  | 'bad-signature';

export type SignatureResult = { ok: true; keyId: string } | { ok: false; reason: SignatureFailure };

/** Claves públicas de confianza: id -> clave SPKI DER en base64. */
export type TrustedKeys = Readonly<Record<string, string>>;

function clean(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`invalid ${field}`);
  // Un salto de línea o un separador permitiría componer un mensaje ambiguo.
  if (/[\r\n|]/.test(value)) throw new Error(`invalid ${field}`);
  return value;
}

function cleanSize(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('invalid size');
  return String(value);
}

/**
 * Mensaje canónico que se firma. Es independiente del formato YAML (orden de claves,
 * comillas, comentarios): solo cuentan los datos que electron-updater usa para descargar
 * y verificar el instalador.
 */
export function canonicalUpdateMessage(info: SignableUpdateInfo): string {
  const version = clean(info.version, 'version');
  let files: SignableFile[] = Array.isArray(info.files) ? (info.files as SignableFile[]) : [];
  if (files.length === 0 && info.path !== undefined) {
    // Mismo respaldo que usa electron-updater (getFileList) para yml antiguos.
    files = [{ url: info.path, sha512: info.sha512 }];
  }
  if (files.length === 0) throw new Error('no files');

  const lines = files.map(f => {
    if (!f || typeof f !== 'object') throw new Error('invalid file');
    return `file=${clean(f.url, 'url')}|${clean(f.sha512, 'sha512')}|${cleanSize(f.size)}`;
  });
  lines.sort();
  // El campo de nivel superior también se firma: electron-updater lo usa si files no lo cubre.
  const topPath = info.path === undefined ? '' : clean(info.path, 'path');
  const topSha = info.sha512 === undefined ? '' : clean(info.sha512, 'sha512');
  return [MESSAGE_HEADER, `version=${version}`, `path=${topPath}|${topSha}`, ...lines, ''].join('\n');
}

export function verifyUpdateSignature(info: SignableUpdateInfo | null | undefined, keys: TrustedKeys): SignatureResult {
  const ids = Object.keys(keys);
  if (ids.length === 0) return { ok: false, reason: 'no-trusted-keys' };
  if (!info || typeof info !== 'object') return { ok: false, reason: 'invalid-metadata' };

  const signature = info[SIGNATURE_FIELD];
  const keyId = info[KEY_ID_FIELD];
  if (typeof signature !== 'string' || signature.length === 0) return { ok: false, reason: 'missing-signature' };
  if (typeof keyId !== 'string' || !Object.prototype.hasOwnProperty.call(keys, keyId)) {
    return { ok: false, reason: 'unknown-key' };
  }

  let message: string;
  try {
    message = canonicalUpdateMessage(info);
  } catch {
    return { ok: false, reason: 'invalid-metadata' };
  }

  try {
    const key = createPublicKey({ key: Buffer.from(keys[keyId], 'base64'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ed25519') return { ok: false, reason: 'unknown-key' };
    const sig = Buffer.from(signature, 'base64');
    if (sig.length !== 64) return { ok: false, reason: 'bad-signature' };
    const valid = verify(null, Buffer.from(message, 'utf8'), key, sig);
    return valid ? { ok: true, keyId } : { ok: false, reason: 'bad-signature' };
  } catch {
    return { ok: false, reason: 'bad-signature' };
  }
}
