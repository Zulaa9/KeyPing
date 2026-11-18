import { promises as fs } from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';

// Utilidades de persistencia segura: escritura atómica (tmp único + fsync + rename) y
// cola de exclusión mutua para operaciones de lectura-modificación-escritura del vault.

async function fsyncDir(dir: string): Promise<void> {
  // En Windows no se puede abrir un directorio para fsync; es de mejor esfuerzo.
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(dir, 'r');
    await handle.sync();
  } catch {
    /* no-op */
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * Escribe `data` en `file` de forma atómica: nunca deja el destino truncado ni mezclado.
 * Usa un temporal con nombre único (evita colisiones entre escrituras concurrentes),
 * fuerza fsync del contenido y renombra encima del destino.
 */
export async function atomicWriteFile(file: string, data: string | Buffer, mode = 0o600): Promise<void> {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  const handle = await fs.open(tmp, 'w', mode);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } catch (err) {
    await handle.close().catch(() => {});
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
  await handle.close();
  try {
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
  await fsyncDir(dir);
}

/** Renombra de forma atómica y sincroniza el directorio (mejor esfuerzo). */
export async function atomicRename(from: string, to: string): Promise<void> {
  await fs.rename(from, to);
  await fsyncDir(path.dirname(to));
}

export async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** Elimina temporales huérfanos de escrituras interrumpidas (p. ej. corte de luz). */
export async function cleanupStaleTemps(file: string): Promise<void> {
  const dir = path.dirname(file);
  const base = path.basename(file);
  try {
    const names = await fs.readdir(dir);
    await Promise.all(
      names
        .filter(n => n.startsWith(`${base}.`) && n.endsWith('.tmp'))
        .map(n => fs.unlink(path.join(dir, n)).catch(() => {}))
    );
  } catch {
    /* no-op */
  }
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Ejecuta `fn` en exclusión mutua con el resto de operaciones del vault.
 * Evita que dos llamadas IPC concurrentes (p. ej. arrastrar varias entradas o una
 * migración en segundo plano) lean la misma versión y una sobrescriba a la otra.
 */
export function withVaultLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}
