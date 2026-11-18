import { randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv, createHmac, timingSafeEqual } from 'crypto';
import { promises as fs } from 'fs';
import { dataFile } from './paths';
import { atomicWriteFile, fileExists } from './fsutil';

// kp-auth.json: replaces kp-master.key. Stores password-derived key verification data.
// kp-master.key: legacy (<= 1.0.x), kept only for one-time migration on first unlock after upgrade.
const LEGACY_KEY_FILE = 'kp-master.key';
const AUTH_FILE = 'kp-auth.json';
const HMAC_KEY_FILE = 'kp-hash.key';
const LEGACY_PBKDF2_ITER = 120_000;
const AUTH_PBKDF2_ITER = 600_000; // OWASP 2023
const KEY_LEN = 32;
const MIN_AUTH_ITER = 100_000;
const MAX_AUTH_ITER = 2_000_000;
const VERIFY_TEXT = 'keyping-master-check';
const GCM_IV_LEN = 12;
const GCM_TAG_LEN = 16;

// In-memory session key. Set after successful auth, cleared on lock.
let sessionKey: Buffer | null = null;

export function setSessionKey(key: Buffer): void {
  if (sessionKey) sessionKey.fill(0);
  sessionKey = Buffer.allocUnsafe(key.length);
  key.copy(sessionKey);
}

export function clearSessionKey(): void {
  if (sessionKey) {
    sessionKey.fill(0);
    sessionKey = null;
  }
}

export function hasSessionKey(): boolean {
  return !!sessionKey;
}

// ---- Auth file (kp-auth.json) ----

export type AuthFileData = {
  salt: string;       // hex
  iterations: number;
  check: string;      // hex: IV(12) + TAG(16) + CIPHER
};

function getAuthFilePath(): string {
  return dataFile(AUTH_FILE);
}

function getLegacyKeyPath(): string {
  return dataFile(LEGACY_KEY_FILE);
}

function getHmacKeyPath(): string {
  return dataFile(HMAC_KEY_FILE);
}

export function clampIterations(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : AUTH_PBKDF2_ITER;
  return Math.max(MIN_AUTH_ITER, Math.min(MAX_AUTH_ITER, n));
}

async function loadAuthFile(): Promise<AuthFileData | null> {
  try {
    const raw = await fs.readFile(getAuthFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.salt !== 'string' ||
      typeof parsed?.check !== 'string' ||
      typeof parsed?.iterations !== 'number'
    ) return null;
    return { salt: parsed.salt, check: parsed.check, iterations: clampIterations(parsed.iterations) };
  } catch {
    return null;
  }
}

async function saveAuthFile(data: AuthFileData): Promise<void> {
  await atomicWriteFile(getAuthFilePath(), JSON.stringify(data));
}

// Rollback helpers for atomic password rotation — read/write raw auth JSON and copy session key.
export async function readAuthFileRaw(): Promise<string | null> {
  try { return await fs.readFile(getAuthFilePath(), 'utf8'); } catch { return null; }
}

export async function writeAuthFileRaw(raw: string): Promise<void> {
  await atomicWriteFile(getAuthFilePath(), raw);
}

export function copySessionKey(): Buffer | null {
  if (!sessionKey) return null;
  const copy = Buffer.allocUnsafe(sessionKey.length);
  sessionKey.copy(copy);
  return copy;
}

export async function hasAuthFile(): Promise<boolean> {
  return fileExists(getAuthFilePath());
}

function makeCheck(key: Buffer): string {
  const nonce = randomBytes(GCM_IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ct = Buffer.concat([cipher.update(VERIFY_TEXT, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, tag, ct]).toString('hex');
}

function checkValid(key: Buffer, checkHex: string): boolean {
  try {
    const buf = Buffer.from(checkHex, 'hex');
    if (buf.length < GCM_IV_LEN + GCM_TAG_LEN + 1) return false;
    const nonce = buf.subarray(0, GCM_IV_LEN);
    const tag = buf.subarray(GCM_IV_LEN, GCM_IV_LEN + GCM_TAG_LEN);
    const ct = buf.subarray(GCM_IV_LEN + GCM_TAG_LEN);
    const dec = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: GCM_TAG_LEN });
    dec.setAuthTag(tag);
    const plain = Buffer.concat([dec.update(ct), dec.final()]);
    const expected = Buffer.from(VERIFY_TEXT, 'utf8');
    return plain.length === expected.length && timingSafeEqual(plain, expected);
  } catch {
    return false;
  }
}

/**
 * Verifies password against kp-auth.json.
 * Returns derived key on success (caller must fill(0) after setSessionKey).
 * Returns null if password is wrong or auth file doesn't exist.
 */
export async function verifyPasswordAndDeriveKey(password: string): Promise<Buffer | null> {
  const auth = await loadAuthFile();
  if (!auth) return null;
  const salt = Buffer.from(auth.salt, 'hex');
  const key = pbkdf2Sync(password, salt, auth.iterations, KEY_LEN, 'sha512');
  if (checkValid(key, auth.check)) {
    return key;
  }
  key.fill(0);
  return null;
}

/**
 * Derives a fresh auth record + key for `password` WITHOUT persisting anything.
 * Callers persist the auth record only after the vault encrypted with `key` is safely on disk
 * (two-phase commit used by setup, rotation and legacy migration).
 */
export function deriveNewAuth(password: string): { auth: AuthFileData; key: Buffer } {
  const salt = randomBytes(32);
  const key = pbkdf2Sync(password, salt, AUTH_PBKDF2_ITER, KEY_LEN, 'sha512');
  const check = makeCheck(key);
  return { auth: { salt: salt.toString('hex'), iterations: AUTH_PBKDF2_ITER, check }, key };
}

export async function commitAuth(auth: AuthFileData): Promise<void> {
  await saveAuthFile(auth);
}

/**
 * Creates kp-auth.json with a new password-derived key and sets it as session key.
 * Only for a fresh install (no vault on disk).
 */
export async function setupMasterPassword(password: string): Promise<void> {
  const { auth, key } = deriveNewAuth(password);
  await saveAuthFile(auth);
  setSessionKey(key);
  key.fill(0);
}

// ---- Legacy key (kp-master.key) — migration only ----

export async function hasLegacyKeyFile(): Promise<boolean> {
  return fileExists(getLegacyKeyPath());
}

export async function deriveLegacyMasterKey(): Promise<Buffer | null> {
  try {
    const data = await fs.readFile(getLegacyKeyPath(), 'utf8');
    const parsed = JSON.parse(data);
    const base = Buffer.from(parsed.base, 'hex');
    const salt = Buffer.from(parsed.salt, 'hex');
    if (!base.length || !salt.length) return null;
    const key = pbkdf2Sync(base, salt, LEGACY_PBKDF2_ITER, KEY_LEN, 'sha512');
    base.fill(0);
    return key;
  } catch {
    return null;
  }
}

export async function removeLegacyKeyFile(): Promise<void> {
  try { await fs.unlink(getLegacyKeyPath()); } catch {}
}

/**
 * Verifica la contraseña contra el verificador que KeyPing <= 1.0.x guardaba en localStorage
 * (`keyping.master.v1`: PBKDF2-SHA256 + AES-GCM de WebCrypto, iv(12) || cifrado || tag(16), base64).
 * Solo se usa en la migración desde el esquema heredado, para que una errata en el primer
 * desbloqueo tras actualizar no se convierta en la nueva contraseña maestra.
 * Devuelve null si el verificador no es interpretable (no permite decidir).
 */
export function verifyLegacyRendererCheck(
  password: string,
  stored: { salt?: unknown; check?: unknown; iterations?: unknown } | null | undefined
): boolean | null {
  if (!stored || typeof stored.salt !== 'string' || typeof stored.check !== 'string') return null;
  try {
    const salt = Buffer.from(stored.salt, 'base64');
    const combined = Buffer.from(stored.check, 'base64');
    if (!salt.length || combined.length < GCM_IV_LEN + GCM_TAG_LEN + 1) return null;
    const rawIter = Number(stored.iterations) || 150_000;
    const iterations = Math.min(2_000_000, Math.max(1_000, Math.round(rawIter)));
    const key = pbkdf2Sync(password, salt, iterations, KEY_LEN, 'sha256');
    try {
      const iv = combined.subarray(0, GCM_IV_LEN);
      const body = combined.subarray(GCM_IV_LEN, combined.length - GCM_TAG_LEN);
      const tag = combined.subarray(combined.length - GCM_TAG_LEN);
      const dec = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: GCM_TAG_LEN });
      dec.setAuthTag(tag);
      const plain = Buffer.concat([dec.update(body), dec.final()]);
      const expected = Buffer.from(VERIFY_TEXT, 'utf8');
      return plain.length === expected.length && timingSafeEqual(plain, expected);
    } catch {
      return false;
    } finally {
      key.fill(0);
    }
  } catch {
    return null;
  }
}

// ---- HMAC key ----

export async function loadOrCreateHmacKey(): Promise<Buffer> {
  const file = getHmacKeyPath();
  try {
    const data = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(data);
    const key = Buffer.from(parsed.key, 'hex');
    if (key.length >= 16) return key;
  } catch {
    /* se regenera abajo */
  }
  // Los hashes se recalculan desde el secreto en cada consulta, así que regenerar la clave
  // HMAC no pierde datos (solo invalida los hashes persistidos, que se rehacen al guardar).
  const key = randomBytes(32);
  await atomicWriteFile(file, JSON.stringify({ key: key.toString('hex') }));
  return key;
}

export function hmacSha256(data: string, key: Buffer): string {
  return createHmac('sha256', key).update(data).digest('hex');
}

// ---- Vault encryption ----

export function encryptWithKey(data: string, key: Buffer): Buffer {
  const nonce = randomBytes(GCM_IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, tag, ciphertext]);
}

// Decrypt with an explicit key (legacy migration, pending-rotation recovery).
export function decryptWithKey(buf: Buffer, key: Buffer): string {
  if (buf.length < GCM_IV_LEN + GCM_TAG_LEN) throw new Error('Ciphertext too short');
  const nonce = buf.subarray(0, GCM_IV_LEN);
  const tag = buf.subarray(GCM_IV_LEN, GCM_IV_LEN + GCM_TAG_LEN);
  const ciphertext = buf.subarray(GCM_IV_LEN + GCM_TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: GCM_TAG_LEN });
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

export async function encryptVault(data: string): Promise<Buffer> {
  if (!sessionKey) throw new Error('No active session');
  return encryptWithKey(data, sessionKey);
}

export async function decryptVault(buf: Buffer): Promise<string> {
  if (!sessionKey) throw new Error('No active session');
  return decryptWithKey(buf, sessionKey);
}

// Kept for backwards compatibility with callers of the 1.1.x API.
export async function decryptVaultWithKey(buf: Buffer, key: Buffer): Promise<string> {
  return decryptWithKey(buf, key);
}
