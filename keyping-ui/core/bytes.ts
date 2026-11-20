// Utilidades de bytes sin dependencias de Node ni del DOM (núcleo compartido).
// Base64 estándar con relleno, como Buffer#toString('base64') en el escritorio.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX: Record<string, number> = Object.fromEntries([...B64].map((c, i) => [c, i]));

export function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function utf8Decode(bytes: Uint8Array): string {
  // Igual que Buffer#toString('utf8'): secuencias inválidas -> U+FFFD (no lanza).
  return new TextDecoder('utf-8').decode(bytes);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return out;
}

/**
 * Decodifica base64 con la misma tolerancia que Buffer.from(s, 'base64') del escritorio:
 * ignora caracteres fuera del alfabeto (espacios, saltos de línea), acepta base64url y
 * se detiene en el primer '='.
 */
export function fromBase64(text: string): Uint8Array {
  const clean: number[] = [];
  for (const ch of text) {
    if (ch === '=') break;
    const c = ch === '-' ? '+' : ch === '_' ? '/' : ch;
    const v = B64_INDEX[c];
    if (v !== undefined) clean.push(v);
  }
  const out: number[] = [];
  for (let i = 0; i + 1 < clean.length; i += 4) {
    const n = (clean[i] << 18) | (clean[i + 1] << 12) | ((clean[i + 2] ?? 0) << 6) | (clean[i + 3] ?? 0);
    out.push((n >> 16) & 255);
    if (i + 2 < clean.length) out.push((n >> 8) & 255);
    if (i + 3 < clean.length) out.push(n & 255);
  }
  return Uint8Array.from(out);
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function fromHex(hex: string): Uint8Array {
  // Como Buffer.from(hex, 'hex'): se detiene en el primer par no hexadecimal.
  const out: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const v = Number.parseInt(hex.slice(i, i + 2), 16);
    if (!/^[0-9a-fA-F]{2}$/.test(hex.slice(i, i + 2)) || Number.isNaN(v)) break;
    out.push(v);
  }
  return Uint8Array.from(out);
}

export function wipe(bytes: Uint8Array | null | undefined): void {
  bytes?.fill(0);
}
