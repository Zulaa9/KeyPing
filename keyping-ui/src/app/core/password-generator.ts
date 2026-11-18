// Generador de contraseñas con aleatoriedad criptográfica (Web Crypto).
// Sustituye a Math.random, que no es apto para generar secretos.

export type GeneratorOptions = {
  length: number;
  upper: boolean;
  lower: boolean;
  numbers: boolean;
  symbols: boolean;
};

export const DEFAULT_GENERATOR_OPTIONS: GeneratorOptions = {
  length: 20,
  upper: true,
  lower: true,
  numbers: true,
  symbols: true
};

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const NUMBERS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?';

/** Entero uniforme en [0, max) sin sesgo de módulo (muestreo por rechazo). */
export function secureRandomInt(max: number, rng: (buf: Uint32Array) => Uint32Array = b => crypto.getRandomValues(b)): number {
  if (!Number.isInteger(max) || max <= 0 || max > 0x1_0000_0000) throw new Error('invalid range');
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    rng(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}

export function generatePassword(opts: Partial<GeneratorOptions> = {}): string {
  const o = { ...DEFAULT_GENERATOR_OPTIONS, ...opts };
  const length = Math.max(4, Math.min(128, Math.round(o.length || DEFAULT_GENERATOR_OPTIONS.length)));

  const pools: string[] = [];
  if (o.upper) pools.push(UPPER);
  if (o.lower) pools.push(LOWER);
  if (o.numbers) pools.push(NUMBERS);
  if (o.symbols) pools.push(SYMBOLS);
  if (pools.length === 0) pools.push(LOWER);

  const all = pools.join('');
  const chars: string[] = [];
  // Garantiza al menos un carácter de cada tipo elegido.
  for (const pool of pools) chars.push(pool[secureRandomInt(pool.length)]);
  while (chars.length < length) chars.push(all[secureRandomInt(all.length)]);

  // Fisher-Yates con índices seguros.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.slice(0, length).join('');
}
