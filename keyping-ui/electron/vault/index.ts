import { randomUUID, pbkdf2Sync, createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { loadVault, saveVault, checkVaultIntegrity, vaultFileExists } from './file';
import { withVaultLock } from './fsutil';
import { normalizeStoredUrl, tryNormalizeStoredUrl } from '../url-utils';
import type { VaultEntry, VaultData } from './types';
import { normalizePattern } from './similarity';
import { encryptVault, decryptVault, loadOrCreateHmacKey, hmacSha256 } from './crypto';
import { loadSettings, saveSettings, DEFAULT_MAX_HISTORY } from './settings';

// Lógica de negocio del vault: altas, edición versionada, historial, import/export y compactación.

const HASH_VERSION = 'hmac-sha256-v1';
const EXPORT_PBKDF2_ITER = 600_000; // OWASP 2023: mínimo 600k para PBKDF2-SHA256

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

function classMask(s: string): number {
  let m = 0;
  if (/[a-z]/.test(s)) m |= 1;
  if (/[A-Z]/.test(s)) m |= 2;
  if (/\d/.test(s))   m |= 4;
  if (/[^A-Za-z0-9]/.test(s)) m |= 8;
  return m;
}

type Indexes = {
  byId: Map<string, VaultEntry>;
  childByPrev: Map<string, VaultEntry>;
};

function buildIndexes(entries: VaultEntry[]): Indexes {
  const byId = new Map<string, VaultEntry>();
  const childByPrev = new Map<string, VaultEntry>();
  for (const e of entries) {
    byId.set(e.id, e);
    if (e.previousId && typeof e.previousId === 'string' && !childByPrev.has(e.previousId)) {
      childByPrev.set(e.previousId, e);
    }
  }
  return { byId, childByPrev };
}

function newestForChain(start: VaultEntry, idx: Indexes): VaultEntry {
  let cur = start;
  const seen = new Set<string>();
  while (idx.childByPrev.has(cur.id) && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = idx.childByPrev.get(cur.id)!;
  }
  return cur;
}

function chainFromNewest(latest: VaultEntry, idx: Indexes): VaultEntry[] {
  const chain: VaultEntry[] = [];
  let cur: VaultEntry | undefined = latest;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    chain.push(cur);
    seen.add(cur.id);
    cur = cur.previousId ? idx.byId.get(cur.previousId) : undefined;
  }
  return chain;
}

function collectChains(entries: VaultEntry[]): VaultEntry[][] {
  const idx = buildIndexes(entries);
  const visited = new Set<string>();
  const chains: VaultEntry[][] = [];

  for (const entry of entries) {
    if (visited.has(entry.id)) continue;
    const latest = newestForChain(entry, idx);
    const chain = chainFromNewest(latest, idx);
    for (const e of chain) visited.add(e.id);
    chains.push(chain);
  }

  return chains;
}

function enforceHistoryLimit(
  vault: VaultData,
  latestId: string,
  maxHistoryPerEntry: number
): { removed: string[] } {
  const idx = buildIndexes(vault.entries);
  const start = idx.byId.get(latestId);
  if (!start) return { removed: [] };
  const latest = newestForChain(start, idx);
  const chain = chainFromNewest(latest, idx);
  if (chain.length <= maxHistoryPerEntry) return { removed: [] };
  const toRemove = chain.slice(maxHistoryPerEntry);
  const ids = new Set(toRemove.map(e => e.id));
  vault.entries = vault.entries.filter(e => !ids.has(e.id));
  return { removed: Array.from(ids) };
}

async function historyLimit(): Promise<number> {
  const settings = await loadSettings();
  return settings.maxHistoryPerEntry ?? DEFAULT_MAX_HISTORY;
}

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
// Validación de entradas (IPC e importación). Nada de lo que llega del renderer o de un
// archivo importado se guarda sin pasar por aquí.
// ---------------------------------------------------------------------------

export const MAX_SECRET_LENGTH = 4096;
const MAX_TEXT_LENGTH = 512;
const MAX_FOLDER_LENGTH = 256;
const MAX_IMPORT_ENTRIES = 50_000;

export type EntryMetaInput = {
  label?: string;
  loginUrl?: string;
  passwordChangeUrl?: string;
  username?: string;
  email?: string;
  folder?: string;
  twoFactorEnabled?: boolean;
  iconName?: string;
  iconSource?: 'auto' | 'manual';
  detectedService?: string;
};

function optText(value: unknown, max = MAX_TEXT_LENGTH): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

function optIconSource(value: unknown): 'auto' | 'manual' | undefined {
  return value === 'auto' || value === 'manual' ? value : undefined;
}

function optTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
}

export function validateSecret(pwd: unknown): string {
  if (typeof pwd !== 'string' || !pwd) throw new Error('invalid-password');
  if (pwd.length > MAX_SECRET_LENGTH) throw new Error('password-too-long');
  return pwd;
}

/** Normaliza los metadatos de una entrada. Lanza `invalid-url:*` si un enlace no es seguro. */
export function sanitizeMeta(input: EntryMetaInput | undefined | null): EntryMetaInput {
  const src = (input && typeof input === 'object') ? input : {};
  return {
    label: optText(src.label),
    loginUrl: normalizeStoredUrl(src.loginUrl),
    passwordChangeUrl: normalizeStoredUrl(src.passwordChangeUrl),
    username: optText(src.username),
    email: optText(src.email),
    folder: optText(src.folder, MAX_FOLDER_LENGTH),
    twoFactorEnabled: typeof src.twoFactorEnabled === 'boolean' ? src.twoFactorEnabled : undefined,
    iconName: optText(src.iconName, 128),
    iconSource: optIconSource(src.iconSource),
    detectedService: optText(src.detectedService, 128)
  };
}

// ---------------------------------------------------------------------------
// Altas, edición e historial
// ---------------------------------------------------------------------------

export async function addPasswordToVault(pwdInput: string, metaInput: EntryMetaInput = {}): Promise<VaultEntry> {
  const pwd = validateSecret(pwdInput);
  const meta = sanitizeMeta(metaInput);
  return withVaultLock(async () => {
    const hmacKey = await getHmacKey();
    const now = Date.now();
    const entry: VaultEntry = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      twoFactorEnabled: !!meta.twoFactorEnabled,
      length: pwd.length,
      classMask: classMask(pwd),
      hash: vaultHash(pwd, hmacKey),
      secret: pwd,
      normalized: normalizePattern(pwd),
      label: meta.label,
      active: true,
      loginUrl: meta.loginUrl || undefined,
      passwordChangeUrl: meta.passwordChangeUrl || undefined,
      username: meta.username,
      email: meta.email,
      folder: meta.folder,
      iconName: meta.iconName,
      iconSource: meta.iconSource,
      detectedService: meta.detectedService
    };

    const vault = await loadVault();
    if (!vault.hashVersion) vault.hashVersion = HASH_VERSION;
    vault.entries.push(entry);
    await saveVault(vault);
    return entry;
  });
}

export async function getVaultEntries(): Promise<VaultEntry[]> {
  return (await loadVault()).entries;
}

export async function softDeleteEntry(id: string): Promise<void> {
  return withVaultLock(async () => {
    const vault = await loadVault();
    const entry = vault.entries.find(e => e.id === id);
    if (!entry) return;
    entry.active = false;
    await saveVault(vault);
  });
}

/**
 * Sustituye la contraseña de una entrada creando una versión nueva y dejando la anterior en el
 * historial. Si la contraseña es idéntica a la actual no crea versión (devuelve la entrada tal cual),
 * así el renderer no necesita descargar el secreto en claro para comparar.
 */
export async function replacePasswordForEntry(id: string, newPwdInput: string): Promise<VaultEntry | null> {
  const newPwd = validateSecret(newPwdInput);
  return withVaultLock(async () => {
    const vault = await loadVault();
    const idx = buildIndexes(vault.entries);
    const target = idx.byId.get(id);
    if (!target) return null;
    // Opera siempre sobre la versión más reciente de la cadena para no crear ramas en el historial.
    const old = newestForChain(target, idx);
    if (old.secret === newPwd && old.active !== false) return old;

    old.active = false;

    const hmacKey = await getHmacKey();
    const newEntry: VaultEntry = {
      ...old,
      id: randomUUID(),
      createdAt: old.createdAt,
      updatedAt: Date.now(),
      twoFactorEnabled: old.twoFactorEnabled,
      length: newPwd.length,
      classMask: classMask(newPwd),
      hash: vaultHash(newPwd, hmacKey),
      normalized: normalizePattern(newPwd),
      secret: newPwd,
      active: true,
      previousId: old.id
    };

    vault.entries.push(newEntry);
    enforceHistoryLimit(vault, newEntry.id, await historyLimit());
    await saveVault(vault);
    return newEntry;
  });
}

export async function getPasswordPlain(id: string): Promise<string | null> {
  const vault = await loadVault();
  const entry = vault.entries.find(e => e.id === id);
  return entry?.secret ?? null;
}

export async function getPasswordHashes(): Promise<{ id: string; hash: string }[]> {
  const hmacKey = await getHmacKey();
  const vault = await loadVault();
  return vault.entries
    .filter(e => e.active !== false)
    .map(e => ({
      id: e.id,
      hash: e.secret ? vaultHash(e.secret, hmacKey) : e.hash
    }));
}

export async function updateEntryMeta(id: string, metaInput: EntryMetaInput): Promise<VaultEntry> {
  const meta = sanitizeMeta(metaInput);
  return withVaultLock(async () => {
    const vault = await loadVault();
    const entry = vault.entries.find(e => e.id === id);
    if (!entry) throw new Error('Entry not found');

    if (typeof meta.label !== 'undefined') entry.label = meta.label;
    if (typeof meta.loginUrl !== 'undefined') entry.loginUrl = meta.loginUrl || undefined;
    if (typeof meta.passwordChangeUrl !== 'undefined') entry.passwordChangeUrl = meta.passwordChangeUrl || undefined;
    if (typeof meta.username !== 'undefined') entry.username = meta.username;
    if (typeof meta.email !== 'undefined') entry.email = meta.email;
    if (typeof meta.folder !== 'undefined') entry.folder = meta.folder;
    if (typeof meta.twoFactorEnabled !== 'undefined') entry.twoFactorEnabled = meta.twoFactorEnabled;
    if (typeof meta.iconName !== 'undefined') entry.iconName = meta.iconName;
    if (typeof meta.iconSource !== 'undefined') entry.iconSource = meta.iconSource;
    if (typeof meta.detectedService !== 'undefined') entry.detectedService = meta.detectedService;
    entry.updatedAt = Date.now();

    await saveVault(vault);
    return entry;
  });
}

export type ImportEntry = Partial<VaultEntry> & { password?: string; secret?: string };

export async function getPasswordHistory(id: string): Promise<VaultEntry[]> {
  const vault = await loadVault();
  const idx = buildIndexes(vault.entries);
  const entry = idx.byId.get(id);
  if (!entry) return [];
  const latest = newestForChain(entry, idx);
  return chainFromNewest(latest, idx);
}

export async function restorePasswordVersion(versionId: string): Promise<VaultEntry | null> {
  return withVaultLock(async () => {
    const vault = await loadVault();
    const idx = buildIndexes(vault.entries);
    const version = idx.byId.get(versionId);
    if (!version) return null;

    const secret = version.secret || '';
    if (!secret || typeof secret !== 'string') return null;

    const latest = newestForChain(version, idx);
    const chain = chainFromNewest(latest, idx);
    for (const e of chain) {
      if (e.active !== false) e.active = false;
    }

    const hmacKey = await getHmacKey();
    const restored: VaultEntry = {
      // Conserva los metadatos actuales (enlaces, carpeta, icono...) y recupera solo la contraseña.
      ...latest,
      id: randomUUID(),
      previousId: latest.id,
      updatedAt: Date.now(),
      createdAt: latest.createdAt,
      active: true,
      length: secret.length,
      classMask: classMask(secret),
      hash: vaultHash(secret, hmacKey),
      normalized: normalizePattern(secret),
      secret,
    };

    vault.entries.push(restored);
    enforceHistoryLimit(vault, restored.id, await historyLimit());
    await saveVault(vault);
    return restored;
  });
}

export async function deleteHistoryVersion(id: string): Promise<boolean> {
  return withVaultLock(async () => {
    const vault = await loadVault();
    const entry = vault.entries.find(e => e.id === id);
    if (!entry) return false;
    if (entry.active !== false) {
      throw new Error('Cannot delete active version');
    }
    // Re-enlaza la cadena para no partir el historial en dos al borrar una versión intermedia.
    for (const e of vault.entries) {
      if (e.previousId === id) e.previousId = entry.previousId;
    }
    vault.entries = vault.entries.filter(e => e.id !== id);
    await saveVault(vault);
    return true;
  });
}

export async function deleteHistoryForEntry(id: string): Promise<number> {
  return withVaultLock(async () => {
    const vault = await loadVault();
    const idx = buildIndexes(vault.entries);
    const entry = idx.byId.get(id);
    if (!entry) return 0;
    const latest = newestForChain(entry, idx);
    const chain = chainFromNewest(latest, idx);
    const keeper = chain.find(e => e.active !== false) || chain[0];
    keeper.active = true;
    delete keeper.previousId;
    const removedIds = new Set(chain.map(e => e.id).filter(x => x !== keeper.id));
    vault.entries = vault.entries.filter(e => !removedIds.has(e.id));
    await saveVault(vault);
    return removedIds.size;
  });
}

export async function compactVault(opts?: { keepOnlyCurrent?: boolean; maxHistoryPerEntry?: number }): Promise<{ removed: number; kept: number; chains: number }> {
  return withVaultLock(async () => {
    const vault = await loadVault();
    const chains = collectChains(vault.entries);
    const removedIds = new Set<string>();
    const requested = typeof opts?.maxHistoryPerEntry === 'number' && Number.isFinite(opts.maxHistoryPerEntry)
      ? opts.maxHistoryPerEntry
      : await historyLimit();
    const limit = Math.max(1, Math.min(200, Math.round(requested)));

    for (const chain of chains) {
      const current = chain.find(e => e.active !== false) || chain[0];
      if (opts?.keepOnlyCurrent) {
        for (const e of chain) {
          if (e.id !== current.id) removedIds.add(e.id);
        }
        current.active = true;
        delete current.previousId;
        continue;
      }

      if (chain.length > limit) {
        for (const e of chain.slice(limit)) {
          removedIds.add(e.id);
        }
      }
    }

    if (removedIds.size > 0) {
      vault.entries = vault.entries.filter(e => !removedIds.has(e.id));
      await saveVault(vault);
    }

    return { removed: removedIds.size, kept: vault.entries.length, chains: chains.length };
  });
}

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
// Exportación e importación
// ---------------------------------------------------------------------------

async function dataForExport(includeHistory: boolean): Promise<VaultData> {
  const vault = await loadVault();
  if (includeHistory) return vault;

  const chains = collectChains(vault.entries);
  const trimmed: VaultEntry[] = [];
  for (const chain of chains) {
    const current = chain.find(e => e.active !== false) || chain[0];
    const copy = { ...current };
    delete copy.previousId;
    trimmed.push(copy);
  }
  return { entries: trimmed, hashVersion: vault.hashVersion };
}

export async function exportEncryptedVault(includeHistory = true): Promise<Buffer> {
  const data = await dataForExport(includeHistory);
  const json = JSON.stringify(data);
  return encryptVault(json);
}

export type MasterExportPayload = { format: string; enc: 'master'; iterations: number; salt: string; data: string };

export async function exportVaultWithPassword(password: string, includeHistory = true): Promise<MasterExportPayload> {
  const data = await dataForExport(includeHistory);
  const json = JSON.stringify(data);
  const { salt, iterations, data: encData } = encryptWithPassword(json, password);
  return { format: 'keyping-export-v2', enc: 'master', iterations, salt, data: encData };
}

export type ParsedImport = {
  entries: ImportEntry[];
  source: 'encrypted' | 'plain' | 'master';
  requiresPassword?: boolean;
  masterPayload?: MasterExportPayload;
};

function assertMasterPayload(parsed: any): MasterExportPayload {
  if (
    typeof parsed?.salt !== 'string' ||
    typeof parsed?.data !== 'string' ||
    (parsed.iterations !== undefined && typeof parsed.iterations !== 'number')
  ) {
    throw new Error('invalid-import-file');
  }
  return {
    format: 'keyping-export-v2',
    enc: 'master',
    iterations: typeof parsed.iterations === 'number' ? parsed.iterations : EXPORT_PBKDF2_ITER,
    salt: parsed.salt,
    data: parsed.data
  };
}

function entriesFromJson(json: string): ImportEntry[] {
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('invalid-import-file');
  }
  const list = Array.isArray(data) ? data : data?.entries;
  if (!Array.isArray(list)) throw new Error('invalid-import-file');
  return list.filter((e: any) => e && typeof e === 'object' && !Array.isArray(e));
}

export async function parseImportPayload(raw: string, password?: string): Promise<ParsedImport> {
  if (typeof raw !== 'string') throw new Error('invalid-import-file');
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('invalid-import-file');
  }

  if (parsed?.format === 'keyping-export-v2' && parsed?.enc === 'master') {
    const payload = assertMasterPayload(parsed);
    if (!password) {
      return { entries: [], source: 'master', requiresPassword: true, masterPayload: payload };
    }
    let decrypted: string;
    try {
      decrypted = decryptWithPassword(payload, password);
    } catch {
      throw new Error('import-wrong-password');
    }
    return { entries: limitImport(entriesFromJson(decrypted)), source: 'master' };
  }

  if (parsed?.format === 'keyping-export-v1' && typeof parsed?.vault === 'string') {
    const buf = Buffer.from(parsed.vault, 'base64');
    let json: string;
    try {
      json = await decryptVault(buf);
    } catch {
      // Exportación nativa: solo se puede abrir con la misma clave de sesión que la creó.
      throw new Error('import-native-key-mismatch');
    }
    return { entries: limitImport(entriesFromJson(json)), source: 'encrypted' };
  }

  if (Array.isArray(parsed?.entries) || Array.isArray(parsed)) {
    return { entries: limitImport(entriesFromJson(raw)), source: 'plain' };
  }

  throw new Error('invalid-import-file');
}

function limitImport(entries: ImportEntry[]): ImportEntry[] {
  if (entries.length > MAX_IMPORT_ENTRIES) throw new Error('import-too-large');
  return entries;
}

/**
 * Convierte entradas importadas en entradas de vault válidas.
 * - Recalcula hash, longitud, máscara y patrón desde el secreto (no se confía en el archivo).
 * - Descarta entradas sin contraseña y enlaces no seguros.
 * - `keepIds`: conserva ids (restaurar una exportación propia). Si no, genera ids nuevos y
 *   re-enlaza `previousId` dentro del lote para que el historial siga encadenado y no apunte
 *   a entradas ajenas ya presentes en la bóveda.
 */
export function mapImportedEntries(rawEntries: ImportEntry[], hmacKey: Buffer, opts: { keepIds: boolean }): VaultEntry[] {
  const idMap = new Map<string, string>();
  const usedIds = new Set<string>();
  for (const raw of rawEntries) {
    const oldId = typeof raw.id === 'string' && raw.id ? raw.id : null;
    if (!oldId || idMap.has(oldId)) continue;
    const newId = opts.keepIds && !usedIds.has(oldId) ? oldId : randomUUID();
    usedIds.add(newId);
    idMap.set(oldId, newId);
  }

  const out: VaultEntry[] = [];
  const seen = new Set<string>();
  for (const raw of rawEntries) {
    const pwdRaw = (raw as any).password ?? raw.secret ?? (raw as any).pwd;
    if (typeof pwdRaw !== 'string' || !pwdRaw || pwdRaw.length > MAX_SECRET_LENGTH) continue;
    const pwd = pwdRaw;

    const oldId = typeof raw.id === 'string' && raw.id ? raw.id : null;
    let id = oldId ? idMap.get(oldId)! : randomUUID();
    if (seen.has(id)) id = randomUUID();
    seen.add(id);

    const prevRaw = typeof raw.previousId === 'string' ? raw.previousId : undefined;
    const previousId = prevRaw ? idMap.get(prevRaw) : undefined;

    const createdAt = optTimestamp(raw.createdAt) ?? Date.now();
    const updatedAt = optTimestamp(raw.updatedAt) ?? createdAt;

    out.push({
      id,
      createdAt,
      updatedAt,
      twoFactorEnabled: !!raw.twoFactorEnabled,
      length: pwd.length,
      classMask: classMask(pwd),
      hash: vaultHash(pwd, hmacKey),
      secret: pwd,
      normalized: normalizePattern(pwd),
      label: optText(raw.label ?? (raw as any).name ?? (raw as any).title),
      active: raw.active !== false,
      previousId: previousId && previousId !== id ? previousId : undefined,
      loginUrl: tryNormalizeStoredUrl(raw.loginUrl) || undefined,
      passwordChangeUrl: tryNormalizeStoredUrl(raw.passwordChangeUrl) || undefined,
      username: optText(raw.username ?? (raw as any).user),
      email: optText(raw.email),
      folder: optText(raw.folder, MAX_FOLDER_LENGTH),
      iconName: optText(raw.iconName, 128),
      iconSource: optIconSource(raw.iconSource),
      detectedService: optText(raw.detectedService, 128)
    });
  }
  return out;
}

async function overwriteWith(entries: VaultEntry[]): Promise<number> {
  await saveVault({ entries, hashVersion: HASH_VERSION });
  return entries.filter(e => e.active !== false).length;
}

export async function overwriteVaultWithEntries(entries: ImportEntry[]): Promise<number> {
  if (!Array.isArray(entries)) throw new Error('invalid-import-file');
  return withVaultLock(async () => {
    const hmacKey = await getHmacKey();
    return overwriteWith(mapImportedEntries(limitImport(entries), hmacKey, { keepIds: true }));
  });
}

export async function importVaultFromEncrypted(base64: string): Promise<number> {
  if (typeof base64 !== 'string') throw new Error('invalid-import-file');
  return withVaultLock(async () => {
    let json: string;
    try {
      json = await decryptVault(Buffer.from(base64, 'base64'));
    } catch {
      throw new Error('import-native-key-mismatch');
    }
    const hmacKey = await getHmacKey();
    return overwriteWith(mapImportedEntries(limitImport(entriesFromJson(json)), hmacKey, { keepIds: true }));
  });
}

export async function importVaultFromMasterEncrypted(payloadInput: unknown, password: string): Promise<number> {
  const payload = assertMasterPayload(payloadInput);
  if (typeof password !== 'string' || !password) throw new Error('import-wrong-password');
  return withVaultLock(async () => {
    let json: string;
    try {
      json = decryptWithPassword(payload, password);
    } catch {
      throw new Error('import-wrong-password');
    }
    const hmacKey = await getHmacKey();
    return overwriteWith(mapImportedEntries(limitImport(entriesFromJson(json)), hmacKey, { keepIds: true }));
  });
}

export async function mergeVaultEntries(entries: ImportEntry[]): Promise<number> {
  if (!Array.isArray(entries)) throw new Error('invalid-import-file');
  return withVaultLock(async () => {
    const hmacKey = await getHmacKey();
    const vault = await loadVault();
    const mapped = mapImportedEntries(limitImport(entries), hmacKey, { keepIds: false });
    vault.entries.push(...mapped);
    if (!vault.hashVersion) vault.hashVersion = HASH_VERSION;
    await saveVault(vault);
    return mapped.filter(e => e.active !== false).length;
  });
}

function encryptWithPassword(plain: string, password: string): { salt: string; iterations: number; data: string } {
  const iterations = EXPORT_PBKDF2_ITER;
  const salt = randomBytes(16);
  const key = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, tag, enc]).toString('base64');
  key.fill(0);
  return { salt: salt.toString('base64'), iterations, data: combined };
}

function decryptWithPassword(payload: { salt: string; iterations: number; data: string }, password: string): string {
  const salt = Buffer.from(payload.salt, 'base64');
  const iterations = Math.min(2_000_000, Math.max(100_000, Math.round(payload.iterations || EXPORT_PBKDF2_ITER)));
  const key = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  try {
    const combined = Buffer.from(payload.data, 'base64');
    if (combined.length < 28) throw new Error('invalid-import-file');
    const iv = combined.subarray(0, 12);
    const tag = combined.subarray(12, 28);
    const cipher = combined.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(cipher), decipher.final()]).toString('utf8');
  } finally {
    key.fill(0);
  }
}

export { checkVaultIntegrity };
export type {
  VaultIntegrityReport,
  VaultIntegrityIssue,
  VaultIntegrityIssueCode,
  VaultIntegrityStatus
} from './types';
