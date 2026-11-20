// Implementación de las primitivas del núcleo (core/crypto-provider.ts) con el módulo crypto de Node.
import { randomBytes, randomUUID, pbkdf2Sync, createCipheriv, createDecipheriv } from 'crypto';
import type { CryptoProvider } from '../../core/crypto-provider';

const GCM_TAG_LEN = 16;

export const nodeCrypto: CryptoProvider = {
  randomBytes: (length: number) => new Uint8Array(randomBytes(length)),
  randomUUID: () => randomUUID(),
  pbkdf2: async (password, salt, iterations, length, hash) =>
    new Uint8Array(pbkdf2Sync(password, salt, iterations, length, hash)),
  aesGcmEncrypt: async (key, iv, plaintext) => {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return { ciphertext: new Uint8Array(ciphertext), tag: new Uint8Array(cipher.getAuthTag()) };
  },
  aesGcmDecrypt: async (key, iv, ciphertext, tag) => {
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: GCM_TAG_LEN });
    decipher.setAuthTag(tag);
    return new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
  }
};
