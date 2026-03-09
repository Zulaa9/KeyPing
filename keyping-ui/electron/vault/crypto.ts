import { randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { app } from 'electron';

// Módulo de cifrado nativo del vault en disco (AES-256-GCM + clave derivada local).
const MASTER_KEY_FILE = 'kp-master.key';
const PBKDF2_ITER = 120000; // seguro y razonablemente rapido
const KEY_LEN = 32;         // AES-256

function getMasterKeyPath(): string {
  return path.join(app.getPath('userData'), MASTER_KEY_FILE);
}

// Deriva una clave a partir de un secreto interno + salt
async function deriveMasterKey(): Promise<Buffer> {
  const file = getMasterKeyPath();

  try {
    // Reutiliza semilla persistida para derivar siempre la misma clave local.
    const data = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(data);
    const base = Buffer.from(parsed.base, 'hex');
    const salt = Buffer.from(parsed.salt, 'hex');

    return pbkdf2Sync(base, salt, PBKDF2_ITER, KEY_LEN, 'sha512');
  } catch {
    // Primera vez: generamos clave
    const base = randomBytes(32);
    const salt = randomBytes(16);

    const key = pbkdf2Sync(base, salt, PBKDF2_ITER, KEY_LEN, 'sha512');

    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      JSON.stringify({
        base: base.toString('hex'),
        salt: salt.toString('hex')
      }),
      'utf8'
    );

    return key;
  }
}

// Encripta: devuelve un unico Buffer = [nonce(12)][tag(16)][ciphertext]
export async function encryptVault(data: string): Promise<Buffer> {
  const key = await deriveMasterKey();
  const nonce = randomBytes(12); // recomendado para AES-GCM

  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([nonce, tag, ciphertext]);
}

// Desencripta a partir del Buffer concatenado
export async function decryptVault(buf: Buffer): Promise<string> {
  // Espera el formato [nonce(12)][tag(16)][ciphertext].
  const key = await deriveMasterKey();

  const nonce = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);

  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}
