// Formato del archivo de exportación de KeyPing (núcleo compartido escritorio/móvil).
//
// Portable (el que se pasa entre ordenador y móvil), «keyping-export-v2», extensión .kpenc:
//   { "format": "keyping-export-v2", "enc": "master", "iterations": 600000,
//     "salt": base64(16 bytes aleatorios), "data": base64(iv[12] || tag[16] || cifrado) }
//   clave = PBKDF2-HMAC-SHA256(contraseña de exportación en UTF-8, salt, iterations, 32 bytes)
//   cifrado = AES-256-GCM(clave, iv) de JSON.stringify({ entries: VaultEntry[], hashVersion })
//   Al importar, las iteraciones se acotan a [100000, 2000000] (0 o ausente = 600000).
//
// No portable, «keyping-export-v1» (enc «native», .keyping): { format, enc, vault: base64 } cifrado
// con la clave de sesión de la bóveda que lo creó; solo se abre en esa misma bóveda.
//
// Texto plano: un array de entradas o { entries: [...] } (importación de otras herramientas).
import { CryptoProvider } from './crypto-provider';
import { concatBytes, fromBase64, toBase64, utf8Decode, utf8Encode, wipe } from './bytes';
import type { ImportEntry } from './vault-model';

export const EXPORT_FORMAT_PORTABLE = 'keyping-export-v2';
export const EXPORT_FORMAT_NATIVE = 'keyping-export-v1';
export const EXPORT_EXTENSION_PORTABLE = '.kpenc';
export const EXPORT_EXTENSION_NATIVE = '.keyping';
export const EXPORT_MIME = 'application/json';
export const EXPORT_PBKDF2_ITER = 600_000; // OWASP 2023: mínimo 600k para PBKDF2-SHA256
export const EXPORT_MIN_ITER = 100_000;
export const EXPORT_MAX_ITER = 2_000_000;
export const EXPORT_SALT_LEN = 16;
export const GCM_IV_LEN = 12;
export const GCM_TAG_LEN = 16;
export const MAX_IMPORT_ENTRIES = 50_000;

export type MasterExportPayload = { format: string; enc: 'master'; iterations: number; salt: string; data: string };

export type ImportClassification =
  | { kind: 'master'; payload: MasterExportPayload }
  | { kind: 'native'; vault: string }
  | { kind: 'plain'; raw: string };

/** Valida la cabecera v2 (mismo criterio que el escritorio 1.3.1). */
export function assertMasterPayload(parsed: any): MasterExportPayload {
  if (
    typeof parsed?.salt !== 'string' ||
    typeof parsed?.data !== 'string' ||
    (parsed.iterations !== undefined && typeof parsed.iterations !== 'number')
  ) {
    throw new Error('invalid-import-file');
  }
  return {
    format: EXPORT_FORMAT_PORTABLE,
    enc: 'master',
    iterations: typeof parsed.iterations === 'number' ? parsed.iterations : EXPORT_PBKDF2_ITER,
    salt: parsed.salt,
    data: parsed.data
  };
}

/** Clasifica el texto de un archivo de importación sin descifrarlo. */
export function classifyImport(raw: string): ImportClassification {
  if (typeof raw !== 'string') throw new Error('invalid-import-file');
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('invalid-import-file');
  }
  if (parsed?.format === EXPORT_FORMAT_PORTABLE && parsed?.enc === 'master') {
    return { kind: 'master', payload: assertMasterPayload(parsed) };
  }
  if (parsed?.format === EXPORT_FORMAT_NATIVE && typeof parsed?.vault === 'string') {
    return { kind: 'native', vault: parsed.vault };
  }
  if (Array.isArray(parsed?.entries) || Array.isArray(parsed)) {
    return { kind: 'plain', raw };
  }
  throw new Error('invalid-import-file');
}

export function clampExportIterations(value: number | undefined): number {
  return Math.min(EXPORT_MAX_ITER, Math.max(EXPORT_MIN_ITER, Math.round(value || EXPORT_PBKDF2_ITER)));
}

/** Cifra el JSON de la bóveda con la contraseña de exportación (lo mismo que el escritorio). */
export async function encryptMasterExport(
  plain: string,
  password: string,
  crypto: CryptoProvider
): Promise<{ salt: string; iterations: number; data: string }> {
  const iterations = EXPORT_PBKDF2_ITER;
  const salt = crypto.randomBytes(EXPORT_SALT_LEN);
  const key = await crypto.pbkdf2(password, salt, iterations, 32, 'sha256');
  try {
    const iv = crypto.randomBytes(GCM_IV_LEN);
    const { ciphertext, tag } = await crypto.aesGcmEncrypt(key, iv, utf8Encode(plain));
    return { salt: toBase64(salt), iterations, data: toBase64(concatBytes(iv, tag, ciphertext)) };
  } finally {
    wipe(key);
  }
}

/** Descifra la parte `data`. Lanza con contraseña incorrecta, archivo truncado o manipulado. */
export async function decryptMasterExport(
  payload: { salt: string; iterations: number; data: string },
  password: string,
  crypto: CryptoProvider
): Promise<string> {
  const salt = fromBase64(payload.salt);
  const iterations = clampExportIterations(payload.iterations);
  const key = await crypto.pbkdf2(password, salt, iterations, 32, 'sha256');
  try {
    const combined = fromBase64(payload.data);
    if (combined.length < 28) throw new Error('invalid-import-file');
    const iv = combined.subarray(0, GCM_IV_LEN);
    const tag = combined.subarray(GCM_IV_LEN, GCM_IV_LEN + GCM_TAG_LEN);
    const body = combined.subarray(GCM_IV_LEN + GCM_TAG_LEN);
    return utf8Decode(await crypto.aesGcmDecrypt(key, iv, body, tag));
  } finally {
    wipe(key);
  }
}

/** Texto exacto del archivo .kpenc (el escritorio escribe JSON.stringify(payload)). */
export function serializeMasterExport(payload: { salt: string; iterations: number; data: string }): string {
  return JSON.stringify({
    format: EXPORT_FORMAT_PORTABLE,
    enc: 'master',
    iterations: payload.iterations,
    salt: payload.salt,
    data: payload.data
  });
}

export function exportFilename(date: Date, extension = EXPORT_EXTENSION_PORTABLE): string {
  return `keyping-vault-${date.toISOString().replace(/[:.]/g, '-')}${extension}`;
}

export function entriesFromJson(json: string): ImportEntry[] {
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('invalid-import-file');
  }
  const list = Array.isArray(data) ? data : data?.entries;
  if (!Array.isArray(list)) throw new Error('invalid-import-file');
  return list.filter((e: any) => e && typeof e === 'object' && !Array.isArray(e));
}

export function limitImport(entries: ImportEntry[]): ImportEntry[] {
  if (entries.length > MAX_IMPORT_ENTRIES) throw new Error('import-too-large');
  return entries;
}
