// Utilidades de los tests del núcleo: almacén en memoria, servicios nativos simulados y acceso
// al código de ESCRITORIO compilado (por defecto dist-electron; KP_DESKTOP_DIST apunta a otra
// compilación, p. ej. la 1.3.1 sin modificar).
import { existsSync, mkdtempSync, rmSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { NativeServices, TextStore } from '../keyping-service';

export function findRoot(): string {
  let dir = __dirname;
  while (!existsSync(path.join(dir, 'package.json'))) dir = path.dirname(dir);
  return dir;
}

export const ROOT = findRoot();
export const FIXTURES = path.join(ROOT, 'core', 'tests', 'fixtures');

export class MemoryStore implements TextStore {
  readonly files = new Map<string, string>();
  async read(name: string) { return this.files.has(name) ? this.files.get(name)! : null; }
  async write(name: string, data: string) { this.files.set(name, data); }
  async remove(name: string) { this.files.delete(name); }
}

export class FakeNative implements NativeServices {
  clipboard: string | null = null;
  copies: { text: string; ttlMs: number }[] = [];
  opened: string[] = [];
  async copySensitive(text: string, ttlMs: number) { this.clipboard = text; this.copies.push({ text, ttlMs }); return true; }
  async clearClipboardIfOwned() { this.clipboard = null; }
  async openExternal(href: string) { this.opened.push(href); return true; }
}

/** Carga los módulos del vault del escritorio compilado con un directorio de datos temporal. */
export function desktop(): { vault: any; crypto: any; paths: any; dist: string } {
  const dist = process.env.KP_DESKTOP_DIST || path.join(ROOT, 'dist-electron');
  const base = existsSync(path.join(dist, 'electron', 'vault')) ? path.join(dist, 'electron', 'vault') : path.join(dist, 'vault');
  if (!existsSync(path.join(base, 'index.js'))) throw new Error(`Falta el escritorio compilado en ${dist} (npm run electron:build)`);
  return {
    vault: require(path.join(base, 'index.js')),
    crypto: require(path.join(base, 'crypto.js')),
    paths: require(path.join(base, 'paths.js')),
    dist
  };
}

/** Ejecuta fn con una bóveda de escritorio nueva en un directorio temporal (nunca la real). */
export async function withDesktopVault<T>(fn: (d: ReturnType<typeof desktop>) => Promise<T>): Promise<T> {
  const d = desktop();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'keyping-core-'));
  d.paths.setDataDirForTests(dir);
  try {
    const { auth, key } = d.crypto.deriveNewAuth('Maestra-Escritorio-1');
    await d.crypto.commitAuth(auth);
    d.crypto.setSessionKey(key);
    return await fn(d);
  } finally {
    d.crypto.clearSessionKey();
    d.paths.setDataDirForTests(null);
    rmSync(dir, { recursive: true, force: true });
  }
}
