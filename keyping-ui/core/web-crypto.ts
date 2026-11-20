// Implementación de las primitivas del núcleo con Web Crypto (WebView de Android/iOS y Node >= 20).
// Mismos algoritmos y parámetros que node-crypto.ts del escritorio.
import type { CryptoProvider, PbkdfHash } from './crypto-provider';
import { concatBytes, utf8Encode } from './bytes';

const GCM_TAG_BITS = 128;

// Tipos mínimos: el núcleo también compila para Node/Electron sin la biblioteca DOM.
type Subtle = any;

function subtle(): Subtle {
  const s = (globalThis as any).crypto?.subtle as Subtle | undefined;
  if (!s) throw new Error('webcrypto-unavailable');
  return s;
}

const HASH_NAME: Record<PbkdfHash, string> = { sha256: 'SHA-256', sha512: 'SHA-512' };

function buf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function aesKey(raw: Uint8Array, usage: 'encrypt' | 'decrypt'): Promise<unknown> {
  // Clave no extraíble: solo vive dentro del motor criptográfico durante la operación.
  return subtle().importKey('raw', buf(raw), { name: 'AES-GCM' }, false, [usage]);
}

export const webCrypto: CryptoProvider = {
  randomBytes(length: number): Uint8Array {
    const out = new Uint8Array(length);
    (globalThis as any).crypto.getRandomValues(out);
    return out;
  },
  randomUUID(): string {
    return (globalThis as any).crypto.randomUUID();
  },
  async pbkdf2(password, salt, iterations, length, hash) {
    const pwd = utf8Encode(password);
    try {
      const base = await subtle().importKey('raw', buf(pwd), 'PBKDF2', false, ['deriveBits']);
      const bits = await subtle().deriveBits(
        { name: 'PBKDF2', salt: buf(salt), iterations, hash: HASH_NAME[hash] },
        base,
        length * 8
      );
      return new Uint8Array(bits);
    } finally {
      pwd.fill(0);
    }
  },
  async aesGcmEncrypt(key, iv, plaintext) {
    const k = await aesKey(key, 'encrypt');
    const out = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: buf(iv), tagLength: GCM_TAG_BITS }, k, buf(plaintext)));
    // Web Crypto devuelve cifrado || etiqueta; el formato de KeyPing los guarda por separado.
    return { ciphertext: out.slice(0, out.length - 16), tag: out.slice(out.length - 16) };
  },
  async aesGcmDecrypt(key, iv, ciphertext, tag) {
    if (tag.length !== 16) throw new Error('invalid-tag');
    const k = await aesKey(key, 'decrypt');
    const plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: buf(iv), tagLength: GCM_TAG_BITS },
      k,
      buf(concatBytes(ciphertext, tag))
    );
    return new Uint8Array(plain);
  }
};
