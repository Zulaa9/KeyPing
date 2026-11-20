// Primitivas criptográficas que el núcleo necesita. Cada plataforma aporta su implementación:
// - escritorio: módulo crypto de Node (electron/vault/node-crypto.ts);
// - móvil: Web Crypto del WebView (src/app/platform/mobile/web-crypto.ts).
// Mismas operaciones y parámetros en las dos, para que los archivos sean intercambiables.

export type PbkdfHash = 'sha256' | 'sha512';

export interface CryptoProvider {
  randomBytes(length: number): Uint8Array;
  randomUUID(): string;
  /** PBKDF2-HMAC con la contraseña en UTF-8 (igual que pbkdf2Sync con un string). */
  pbkdf2(password: string, salt: Uint8Array, iterations: number, length: number, hash: PbkdfHash): Promise<Uint8Array>;
  /** AES-256-GCM con etiqueta de 16 bytes, devuelta aparte del texto cifrado. */
  aesGcmEncrypt(key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array): Promise<{ ciphertext: Uint8Array; tag: Uint8Array }>;
  /** Lanza si la etiqueta no verifica (contraseña incorrecta o datos manipulados). */
  aesGcmDecrypt(key: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array, tag: Uint8Array): Promise<Uint8Array>;
}
