import { randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv, createHmac } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { app } from 'electron';

// Módulo de cifrado nativo del vault en disco (AES-256-GCM + clave derivada local).
const MASTER_KEY_FILE = 'kp-master.key';
const HMAC_KEY_FILE = 'kp-hash.key';
const PBKDF2_ITER = 120000;
const KEY_LEN = 32;

function getMasterKeyPath(): string {
  return path.join(app.getPath('userData'), MASTER_KEY_FILE);
}

function getHmacKeyPath(): string {
  return path.join(app.getPath('userData'), HMAC_KEY_FILE);
}

async function deriveMasterKey(): Promise<Buffer> {
  const file = getMasterKeyPath();

  try {
    const data = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(data);
    const base = Buffer.from(parsed.base, 'hex');
    const salt = Buffer.from(parsed.salt, 'hex');
    const key = pbkdf2Sync(base, salt, PBKDF2_ITER, KEY_LEN, 'sha512');
    base.fill(0);
    return key;
  } catch {
    const base = randomBytes(32);
    const salt = randomBytes(16);
    const key = pbkdf2Sync(base, salt, PBKDF2_ITER, KEY_LEN, 'sha512');

    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      JSON.stringify({ base: base.toString('hex'), salt: salt.toString('hex') }),
      { encoding: 'utf8', mode: 0o600 }
    );
    base.fill(0);
    return key;
  }
}

export async function loadOrCreateHmacKey(): Promise<Buffer> {
  const file = getHmacKeyPath();
  try {
    const data = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(data);
    return Buffer.from(parsed.key, 'hex');
  } catch {
    const key = randomBytes(32);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      JSON.stringify({ key: key.toString('hex') }),
      { encoding: 'utf8', mode: 0o600 }
    );
    return key;
  }
}

export function hmacSha256(data: string, key: Buffer): string {
  return createHmac('sha256', key).update(data).digest('hex');
}

export async function encryptVault(data: string): Promise<Buffer> {
  const key = await deriveMasterKey();
  const nonce = randomBytes(12);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const ciphertext = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([nonce, tag, ciphertext]);
  } finally {
    key.fill(0);
  }
}

export async function decryptVault(buf: Buffer): Promise<string> {
  const key = await deriveMasterKey();
  const nonce = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } finally {
    key.fill(0);
  }
}
