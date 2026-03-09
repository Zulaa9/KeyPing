import { promises as fs } from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { encryptVault, decryptVault } from './crypto';
import {
  VaultData,
  VaultEntry,
  VaultIntegrityIssue,
  VaultIntegrityReport,
  VaultIntegrityStatus
} from './types';

// Persistencia física del vault cifrado y chequeos de integridad.
function vaultPath(): string {
  return path.join(app.getPath('userData'), 'keyping-vault.kp');
}

const MIN_TIMESTAMP_MS = new Date('2010-01-01').getTime();
const MAX_FUTURE_DRIFT_MS = 365 * 24 * 60 * 60 * 1000; // tolerancia de 1 ano

function migrate(data: any): VaultData {
  // Migraciones de esquema al cargar para mantener compatibilidad hacia atrás.
  const entries: VaultEntry[] = Array.isArray(data?.entries) ? data.entries : [];

  for (const e of entries) {
    // Migracion antigua: note -> label
    if (!e.label && (e as any).note) {
      e.label = (e as any).note;
      delete (e as any).note;
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

export async function loadVault(): Promise<VaultData> {
  const file = vaultPath();
  try {
    const buf = await fs.readFile(file);
    const json = await decryptVault(buf);
    const raw = JSON.parse(json);
    return migrate(raw);
  } catch (err: any) {
    if (err.code === 'ENOENT') return { entries: [] };
    console.error('[vault] load error:', err);
    return { entries: [] };
  }
}

export async function saveVault(data: VaultData): Promise<void> {
  const file = vaultPath();
  const json = JSON.stringify(data);
  const encrypted = await encryptVault(json);

  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, encrypted);
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
