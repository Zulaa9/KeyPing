import { randomUUID } from 'crypto';
import { loadVault, saveVault, checkVaultIntegrity, vaultFileExists } from './file';
import { withVaultLock } from './fsutil';
import type { VaultEntry, VaultData } from './types';
import { encryptVault, decryptVault, loadOrCreateHmacKey, hmacSha256 } from './crypto';
import { loadSettings, saveSettings, DEFAULT_MAX_HISTORY } from './settings';
import { VaultOps } from '../../core/vault-ops';
import { HASH_VERSION, mapImportedEntries as coreMapImportedEntries } from '../../core/vault-model';
import type { EntryMetaInput, ImportEntry } from '../../core/vault-model';
import {
  MasterExportPayload,
  assertMasterPayload,
  classifyImport,
  decryptMasterExport,
  encryptMasterExport,
  entriesFromJson,
  limitImport
} from '../../core/export-format';
import { nodeCrypto } from './node-crypto';

// Lógica de negocio del vault: la comparte el núcleo (core/vault-ops.ts, core/vault-model.ts,
// core/export-format.ts). Aquí se conecta con el almacenamiento, el HMAC y el cierre del proceso principal.

export { MAX_SECRET_LENGTH, validateSecret, sanitizeMeta } from '../../core/vault-model';
export type { EntryMetaInput, ImportEntry } from '../../core/vault-model';
export type { MasterExportPayload } from '../../core/export-format';

let cachedHmacKey: Buffer | null = null;

async function getHmacKey(): Promise<Buffer> {
  if (!cachedHmacKey) {
    cachedHmacKey = await loadOrCreateHmacKey();
  }
  return cachedHmacKey;
}

function vaultHash(secret: string, key: Buffer): string {
  return hmacSha256(secret, key);
}

async function historyLimit(): Promise<number> {
  const settings = await loadSettings();
  return settings.maxHistoryPerEntry ?? DEFAULT_MAX_HISTORY;
}

const ops = new VaultOps({
  load: loadVault,
  save: saveVault,
  hasher: async () => {
    const key = await getHmacKey();
    return (secret: string) => vaultHash(secret, key);
  },
  uuid: () => randomUUID(),
  historyLimit,
  lock: withVaultLock
});

// Migra hashes SHA-256 planos a HMAC-SHA256 con clave de vault y elimina campo `password` duplicado.
export async function runStartupMigrations(): Promise<void> {
  return withVaultLock(async () => {
  if (!(await vaultFileExists())) return;
  const vault = await loadVault();
  if (vault.hashVersion === HASH_VERSION && !vault.entries.some(e => (e as any).password !== undefined)) return;

  const hmacKey = await getHmacKey();
  for (const entry of vault.entries) {
    const secret = entry.secret || (entry as any).password || '';
    if (secret) {
      // Nunca borrar el campo heredado `password` sin haber copiado antes su valor a `secret`.
      if (!entry.secret) entry.secret = secret;
      entry.hash = vaultHash(secret, hmacKey);
    }
    if (entry.secret) delete (entry as any).password;
  }
  vault.hashVersion = HASH_VERSION;
  await saveVault(vault);
  });
}

// ---------------------------------------------------------------------------
// Altas, edición e historial (núcleo compartido)
// ---------------------------------------------------------------------------

export const addPasswordToVault = (pwdInput: string, metaInput: EntryMetaInput = {}): Promise<VaultEntry> =>
  ops.add(pwdInput, metaInput);
export const getVaultEntries = (): Promise<VaultEntry[]> => ops.entries();
export const softDeleteEntry = (id: string): Promise<void> => ops.softDelete(id);
export const replacePasswordForEntry = (id: string, newPwdInput: string): Promise<VaultEntry | null> =>
  ops.replacePassword(id, newPwdInput);
export const getPasswordPlain = (id: string): Promise<string | null> => ops.passwordPlain(id);
export const getPasswordHashes = (): Promise<{ id: string; hash: string }[]> => ops.passwordHashes();
export const updateEntryMeta = (id: string, metaInput: EntryMetaInput): Promise<VaultEntry> => ops.updateMeta(id, metaInput);
export const getPasswordHistory = (id: string): Promise<VaultEntry[]> => ops.history(id);
export const restorePasswordVersion = (versionId: string): Promise<VaultEntry | null> => ops.restoreVersion(versionId);
export const deleteHistoryVersion = (id: string): Promise<boolean> => ops.deleteVersion(id);
export const deleteHistoryForEntry = (id: string): Promise<number> => ops.clearHistory(id);
export const compactVault = (opts?: { keepOnlyCurrent?: boolean; maxHistoryPerEntry?: number }) => ops.compact(opts);

export async function getHistorySettings(): Promise<{ maxHistoryPerEntry: number }> {
  return await loadSettings();
}

export async function updateHistorySettings(maxHistoryPerEntry: number): Promise<{ maxHistoryPerEntry: number }> {
  if (typeof maxHistoryPerEntry !== 'number' || !Number.isFinite(maxHistoryPerEntry)) {
    throw new Error('invalid-history-limit');
  }
  return await saveSettings({ maxHistoryPerEntry });
}

// ---------------------------------------------------------------------------
// Exportación e importación (formato en core/export-format.ts)
// ---------------------------------------------------------------------------

export async function exportEncryptedVault(includeHistory = true): Promise<Buffer> {
  return encryptVault(await ops.exportJson(includeHistory));
}

export async function exportVaultWithPassword(password: string, includeHistory = true): Promise<MasterExportPayload> {
  const json = await ops.exportJson(includeHistory);
  const { salt, iterations, data: encData } = await encryptMasterExport(json, password, nodeCrypto);
  return { format: 'keyping-export-v2', enc: 'master', iterations, salt, data: encData };
}

export type ParsedImport = {
  entries: ImportEntry[];
  source: 'encrypted' | 'plain' | 'master';
  requiresPassword?: boolean;
  masterPayload?: MasterExportPayload;
};

export async function parseImportPayload(raw: string, password?: string): Promise<ParsedImport> {
  const kind = classifyImport(raw);

  if (kind.kind === 'master') {
    const payload = kind.payload;
    if (!password) {
      return { entries: [], source: 'master', requiresPassword: true, masterPayload: payload };
    }
    let decrypted: string;
    try {
      decrypted = await decryptMasterExport(payload, password, nodeCrypto);
    } catch {
      throw new Error('import-wrong-password');
    }
    return { entries: limitImport(entriesFromJson(decrypted)), source: 'master' };
  }

  if (kind.kind === 'native') {
    const buf = Buffer.from(kind.vault, 'base64');
    let json: string;
    try {
      json = await decryptVault(buf);
    } catch {
      // Exportación nativa: solo se puede abrir con la misma clave de sesión que la creó.
      throw new Error('import-native-key-mismatch');
    }
    return { entries: limitImport(entriesFromJson(json)), source: 'encrypted' };
  }

  return { entries: limitImport(entriesFromJson(kind.raw)), source: 'plain' };
}

/** Firma heredada (tests y llamadas existentes): hash con la clave HMAC en Buffer. */
export function mapImportedEntries(rawEntries: ImportEntry[], hmacKey: Buffer, opts: { keepIds: boolean }): VaultEntry[] {
  return coreMapImportedEntries(rawEntries, secret => vaultHash(secret, hmacKey), () => randomUUID(), opts);
}

export const overwriteVaultWithEntries = (entries: ImportEntry[]): Promise<number> => ops.overwrite(entries);

export async function importVaultFromEncrypted(base64: string): Promise<number> {
  if (typeof base64 !== 'string') throw new Error('invalid-import-file');
  let json: string;
  try {
    json = await decryptVault(Buffer.from(base64, 'base64'));
  } catch {
    throw new Error('import-native-key-mismatch');
  }
  return ops.overwrite(limitImport(entriesFromJson(json)));
}

export async function importVaultFromMasterEncrypted(payloadInput: unknown, password: string): Promise<number> {
  const payload = assertMasterPayload(payloadInput);
  if (typeof password !== 'string' || !password) throw new Error('import-wrong-password');
  let json: string;
  try {
    json = await decryptMasterExport(payload, password, nodeCrypto);
  } catch {
    throw new Error('import-wrong-password');
  }
  return ops.overwrite(limitImport(entriesFromJson(json)));
}

export const mergeVaultEntries = (entries: ImportEntry[]): Promise<number> => ops.merge(entries);

export { checkVaultIntegrity };
export type {
  VaultIntegrityReport,
  VaultIntegrityIssue,
  VaultIntegrityIssueCode,
  VaultIntegrityStatus
} from './types';
