import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import { encryptVault, decryptVault, decryptWithKey, encryptWithKey } from './crypto';
import { dataFile } from './paths';
import { atomicWriteFile, atomicRename, cleanupStaleTemps, fileExists } from './fsutil';
import {
  VaultData,
  VaultEntry,
  VaultIntegrityIssue,
  VaultIntegrityReport,
  VaultIntegrityStatus
} from './types';

// Persistencia física del vault cifrado y chequeos de integridad.
export const VAULT_FILE = 'keyping-vault.kp';

export function vaultPath(): string {
  return dataFile(VAULT_FILE);
}

// Copia cifrada con la clave nueva durante un cambio de contraseña o una migración heredada.
// Solo se promueve a vault principal cuando kp-auth.json ya refleja esa clave (commit en dos fases).
export function pendingVaultPath(): string {
  return dataFile(`${VAULT_FILE}.pending`);
}

/**
 * El vault existe pero no se puede leer (clave incorrecta, archivo truncado o corrupto).
 * Se lanza en lugar de devolver un vault vacío: antes, cualquier guardado posterior
 * sobrescribía la bóveda real con una lista vacía.
 */
export class VaultUnreadableError extends Error {
  readonly code = 'VAULT_UNREADABLE';
  constructor(readonly reason: 'too-short' | 'decrypt-failed' | 'invalid-json' | 'invalid-structure' | 'read-error') {
    super(`Vault unreadable (${reason})`);
    this.name = 'VaultUnreadableError';
  }
}

export async function vaultFileExists(): Promise<boolean> {
  return fileExists(vaultPath());
}

const MIN_TIMESTAMP_MS = new Date('2010-01-01').getTime();
const MAX_FUTURE_DRIFT_MS = 365 * 24 * 60 * 60 * 1000; // tolerancia de 1 ano

function migrate(data: any): VaultData {
  // Migraciones de esquema al cargar para mantener compatibilidad hacia atrás.
  const entries: VaultEntry[] = Array.isArray(data?.entries)
    ? data.entries.filter((e: any) => e && typeof e === 'object' && !Array.isArray(e))
    : [];

  for (const e of entries) {
    // Migracion antigua: note -> label
    if (!e.label && (e as any).note) {
      e.label = (e as any).note;
      delete (e as any).note;
    }
    if (typeof e.id !== 'string' || !e.id) {
      // Nunca descartar una entrada por no tener id: se le asigna uno estable a partir de ahora.
      e.id = randomUUID();
    }
    if (typeof e.active === 'undefined') {
      e.active = true;
    }
    // loginUrl / passwordChangeUrl pueden venir ya o no, no tocamos nada más
  }

  return { entries };
}

function isPlausibleTimestamp(ts: any, now: number): boolean {
  // Evita datos claramente corruptos (fechas imposibles o muy futuras).
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return false;
  if (ts < MIN_TIMESTAMP_MS) return false;
  if (ts > now + MAX_FUTURE_DRIFT_MS) return false;
  return true;
}

function computeStatus(issues: VaultIntegrityIssue[]): VaultIntegrityStatus {
  if (!issues.length) return 'ok';
  const hasError = issues.some(i =>
    i.code !== 'missing-file' && i.code !== 'implausible-timestamps'
  );
  return hasError ? 'error' : 'warn';
}

function parseVaultJson(json: string): VaultData {
  let raw: any;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new VaultUnreadableError('invalid-json');
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.entries)) {
    throw new VaultUnreadableError('invalid-structure');
  }
  const data = migrate(raw);
  if (typeof raw.hashVersion === 'string') data.hashVersion = raw.hashVersion;
  return data;
}

async function readVaultFile(): Promise<Buffer | null> {
  try {
    return await fs.readFile(vaultPath());
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw new VaultUnreadableError('read-error');
  }
}

/** Lee el vault con la clave de sesión. Devuelve vacío SOLO si el archivo no existe. */
export async function loadVault(): Promise<VaultData> {
  const buf = await readVaultFile();
  if (!buf) return { entries: [] };
  if (buf.byteLength < 28) throw new VaultUnreadableError('too-short');
  let json: string;
  try {
    json = await decryptVault(buf);
  } catch (err: any) {
    if (err?.message === 'No active session') throw err;
    throw new VaultUnreadableError('decrypt-failed');
  }
  return parseVaultJson(json);
}

export async function saveVault(data: VaultData): Promise<void> {
  const json = JSON.stringify(data);
  const encrypted = await encryptVault(json);
  await atomicWriteFile(vaultPath(), encrypted);
}

/** Lee el vault con una clave explícita (migración heredada / recuperación). Estricto: lanza si no puede. */
export async function loadVaultWithKey(key: Buffer): Promise<VaultData> {
  const buf = await readVaultFile();
  if (!buf) return { entries: [] };
  if (buf.byteLength < 28) throw new VaultUnreadableError('too-short');
  let json: string;
  try {
    json = decryptWithKey(buf, key);
  } catch {
    throw new VaultUnreadableError('decrypt-failed');
  }
  return parseVaultJson(json);
}

/** Fase 1 del commit en dos fases: escribe el vault cifrado con `key` en el archivo pendiente. */
export async function writePendingVault(data: VaultData, key: Buffer): Promise<void> {
  await atomicWriteFile(pendingVaultPath(), encryptWithKey(JSON.stringify(data), key));
}

/** Fase 3: promueve el archivo pendiente a vault principal. */
export async function promotePendingVault(): Promise<void> {
  await atomicRename(pendingVaultPath(), vaultPath());
}

export async function discardPendingVault(): Promise<void> {
  await fs.unlink(pendingVaultPath()).catch(() => {});
}

/**
 * Recupera un cambio de contraseña o migración interrumpidos.
 * Si existe un vault pendiente descifrable con la clave ya verificada, el auth nuevo llegó
 * a disco y solo faltaba el renombrado: se completa. Si no, el auth nuevo nunca se guardó y
 * el pendiente es inservible: se descarta. Idempotente.
 */
export async function recoverPendingVault(key: Buffer): Promise<'none' | 'promoted' | 'discarded'> {
  await cleanupStaleTemps(vaultPath());
  let buf: Buffer;
  try {
    buf = await fs.readFile(pendingVaultPath());
  } catch {
    return 'none';
  }
  try {
    parseVaultJson(decryptWithKey(buf, key));
  } catch {
    await discardPendingVault();
    return 'discarded';
  }
  await promotePendingVault();
  return 'promoted';
}

export async function resetVault(): Promise<void> {
  const file = vaultPath();
  try { await fs.unlink(file); } catch {}
}

export async function checkVaultIntegrity(): Promise<VaultIntegrityReport> {
  // Verificación defensiva por etapas: lectura, cabecera, decrypt, JSON y estructura.
  const file = vaultPath();
  const issues: VaultIntegrityIssue[] = [];
  const checkedAt = Date.now();

  let buf: Buffer;
  try {
    buf = await fs.readFile(file);
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      issues.push({ code: 'missing-file' });
      return {
        status: computeStatus(issues),
        fileExists: false,
        issues,
        checkedAt
      };
    }
    console.error('[vault] integrity read error:', err);
    issues.push({ code: 'read-error' });
    return {
      status: computeStatus(issues),
      fileExists: false,
      issues,
      checkedAt
    };
  }

  if (!buf || buf.byteLength < 28) {
    issues.push({ code: 'invalid-header', detail: 'too-short' });
    return {
      status: computeStatus(issues),
      fileExists: true,
      issues,
      checkedAt
    };
  }

  let json: string;
  try {
    json = await decryptVault(buf);
  } catch (err) {
    console.error('[vault] integrity decrypt error:', err);
    issues.push({ code: 'decrypt-failed' });
    return {
      status: computeStatus(issues),
      fileExists: true,
      issues,
      checkedAt
    };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    console.error('[vault] integrity json parse error:', err);
    issues.push({ code: 'invalid-json' });
    return {
      status: computeStatus(issues),
      fileExists: true,
      issues,
      checkedAt
    };
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entries)) {
    issues.push({ code: 'invalid-structure' });
    return {
      status: computeStatus(issues),
      fileExists: true,
      issues,
      checkedAt
    };
  }

  const migrated = migrate(parsed);
  const now = Date.now();
  const implausibleCount = migrated.entries.reduce((acc, entry) => {
    const createdOk = isPlausibleTimestamp(entry.createdAt, now);
    const updatedOk =
      typeof entry.updatedAt === 'undefined'
        ? true
        : isPlausibleTimestamp(entry.updatedAt, now) && entry.updatedAt >= entry.createdAt;
    return createdOk && updatedOk ? acc : acc + 1;
  }, 0);

  if (implausibleCount > 0) {
    issues.push({ code: 'implausible-timestamps', count: implausibleCount });
  }

  return {
    status: computeStatus(issues),
    fileExists: true,
    issues,
    entries: migrated.entries.length,
    checkedAt
  };
}
