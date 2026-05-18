import { randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv, createHmac } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { app } from 'electron';

// kp-auth.json: replaces kp-master.key. Stores password-derived key verification data.
// kp-master.key: legacy, kept only for one-time migration on first unlock after upgrade.
const LEGACY_KEY_FILE = 'kp-master.key';
const AUTH_FILE = 'kp-auth.json';
const HMAC_KEY_FILE = 'kp-hash.key';
const LEGACY_PBKDF2_ITER = 120_000;
const AUTH_PBKDF2_ITER = 600_000; // OWASP 2023
const KEY_LEN = 32;
const MIN_AUTH_ITER = 100_000;
const MAX_AUTH_ITER = 2_000_000;
const VERIFY_TEXT = 'keyping-master-check';

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

// ---- Auth file (kp-auth.json) ----

type AuthFileData = {
  salt: string;       // hex
  iterations: number;
  check: string;      // hex: IV(12) + TAG(16) + CIPHER
};

function getAuthFilePath(): string {
  return path.join(app.getPath('userData'), AUTH_FILE);
}

function getLegacyKeyPath(): string {
  return path.join(app.getPath('userData'), LEGACY_KEY_FILE);
}

function getHmacKeyPath(): string {
  return path.join(app.getPath('userData'), HMAC_KEY_FILE);
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
    const iterations = Math.max(MIN_AUTH_ITER, Math.min(MAX_AUTH_ITER, Math.round(parsed.iterations)));
    return { salt: parsed.salt, check: parsed.check, iterations };
  } catch {
    return null;
  }
}

async function saveAuthFile(data: AuthFileData): Promise<void> {
  const file = getAuthFilePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 });
}

export async function hasAuthFile(): Promise<boolean> {
  try {
    await fs.access(getAuthFilePath());
    return true;
  } catch {
    return false;
  }
}

function makeCheck(key: Buffer): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ct = Buffer.concat([cipher.update(VERIFY_TEXT, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, tag, ct]).toString('hex');
}

function checkValid(key: Buffer, checkHex: string): boolean {
  try {
    const buf = Buffer.from(checkHex, 'hex');
    const nonce = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const dec = createDecipheriv('aes-256-gcm', key, nonce);
    dec.setAuthTag(tag);
    const plain = Buffer.concat([dec.update(ct), dec.final()]).toString('utf8');
    return plain === VERIFY_TEXT;
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
 * Creates kp-auth.json with a new password-derived key and sets it as session key.
 * Called during initial setup and password rotation.
 */
export async function setupMasterPassword(password: string): Promise<void> {
  const salt = randomBytes(32);
  const key = pbkdf2Sync(password, salt, AUTH_PBKDF2_ITER, KEY_LEN, 'sha512');
  const check = makeCheck(key);
  await saveAuthFile({ salt: salt.toString('hex'), iterations: AUTH_PBKDF2_ITER, check });
  setSessionKey(key);
  key.fill(0);
}

// ---- Legacy key (kp-master.key) — migration only ----

export async function deriveLegacyMasterKey(): Promise<Buffer | null> {
  try {
    const data = await fs.readFile(getLegacyKeyPath(), 'utf8');
    const parsed = JSON.parse(data);
    const base = Buffer.from(parsed.base, 'hex');
    const salt = Buffer.from(parsed.salt, 'hex');
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

// ---- HMAC key ----

export async function loadOrCreateHmacKey(): Promise<Buffer> {
  const file = getHmacKeyPath();
  try {
    const data = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(data);
    return Buffer.from(parsed.key, 'hex');
  } catch {
    const key = randomBytes(32);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ key: key.toString('hex') }), { encoding: 'utf8', mode: 0o600 });
    return key;
  }
}

export function hmacSha256(data: string, key: Buffer): string {
  return createHmac('sha256', key).update(data).digest('hex');
}

// ---- Vault encryption (uses in-memory session key) ----

export async function encryptVault(data: string): Promise<Buffer> {
  if (!sessionKey) throw new Error('No active session');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sessionKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, tag, ciphertext]);
}

export async function decryptVault(buf: Buffer): Promise<string> {
  if (!sessionKey) throw new Error('No active session');
  const nonce = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', sessionKey, nonce);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

// Decrypt with an explicit key — used only during migration from legacy scheme.
export async function decryptVaultWithKey(buf: Buffer, key: Buffer): Promise<string> {
  const nonce = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}
