import { randomUUID, createHash, pbkdf2Sync, createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { loadVault, saveVault, checkVaultIntegrity } from './file';
import type { VaultEntry, VaultData } from './types';
import { normalizePattern } from './similarity';
import { encryptVault, decryptVault } from './crypto';
import { loadSettings, saveSettings, DEFAULT_MAX_HISTORY } from './settings';

// Lógica de negocio del vault: altas, edición versionada, historial, import/export y compactación.
function classMask(s: string): number {
  let m = 0;
  if (/[a-z]/.test(s)) m |= 1;
  if (/[A-Z]/.test(s)) m |= 2;
  if (/\d/.test(s))   m |= 4;
  if (/[^A-Za-z0-9]/.test(s)) m |= 8;
  return m;
}

type Indexes = {
  // Índices auxiliares para navegar cadenas de versiones sin recorrer N veces.
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
  // Agrupa el vault por cadenas de versionado (latest -> ... -> oldest).
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
  // Usa valor por defecto si ajustes no define un límite explícito.
  const settings = await loadSettings();
  return settings.maxHistoryPerEntry ?? DEFAULT_MAX_HISTORY;
}

export async function addPasswordToVault(
  pwd: string,
  label?: string,
  loginUrl?: string,
  passwordChangeUrl?: string,
  username?: string,
  email?: string,
  folder?: string,
  twoFactorEnabled?: boolean,
  iconName?: string,
  iconSource?: 'auto' | 'manual',
  detectedService?: string
): Promise<VaultEntry> {
  const hash = createHash('sha256').update(pwd).digest('hex');
  const normalized = normalizePattern(pwd);

  const entry: VaultEntry = {
    id: randomUUID(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    twoFactorEnabled: !!twoFactorEnabled,
    length: pwd.length,
    classMask: classMask(pwd),
    hash,
    secret: pwd,
    normalized,
    label,
    password: pwd,
    active: true,
    loginUrl,
    passwordChangeUrl,
    username,
    email,
    folder,
    iconName,
    iconSource,
    detectedService
  };

  const vault = await loadVault();
  vault.entries.push(entry);
  await saveVault(vault);

  return entry;
}

export async function getVaultEntries(): Promise<VaultEntry[]> {
  return (await loadVault()).entries;
}

export async function softDeleteEntry(id: string): Promise<void> {
  const vault = await loadVault();
  const idx = vault.entries.findIndex(e => e.id === id);
  if (idx === -1) return;
  vault.entries[idx].active = false;
  await saveVault(vault);
}

export async function replacePasswordForEntry(
  id: string,
  newPwd: string
): Promise<VaultEntry | null> {
  // Edición "append-only": conserva historial, crea nueva versión y desactiva la anterior.
  const vault = await loadVault();
  const old = vault.entries.find(e => e.id === id);
  if (!old) return null;

  old.active = false;

  const hash = createHash('sha256').update(newPwd).digest('hex');
  const normalized = normalizePattern(newPwd);

  const newEntry: VaultEntry = {
    ...old,
    id: randomUUID(),
    createdAt: old.createdAt,
    updatedAt: Date.now(),
    twoFactorEnabled: old.twoFactorEnabled,
    length: newPwd.length,
    classMask: classMask(newPwd),
    hash,
    normalized,
    secret: newPwd,
    password: newPwd,
    active: true,
    previousId: old.id
  };

  vault.entries.push(newEntry);
  const maxHistory = await historyLimit();
  enforceHistoryLimit(vault, newEntry.id, maxHistory);
  await saveVault(vault);

  return newEntry;
}

export async function getPasswordPlain(id: string): Promise<string | null> {
  const vault = await loadVault();
  const entry = vault.entries.find(e => e.id === id);
  return entry?.secret ?? null;
}

export async function updateEntryMeta(
  id: string,
  label?: string,
  loginUrl?: string,
  passwordChangeUrl?: string,
  username?: string,
  email?: string,
  folder?: string,
  twoFactorEnabled?: boolean,
  iconName?: string,
  iconSource?: 'auto' | 'manual',
  detectedService?: string
): Promise<VaultEntry> {
  const vault = await loadVault();
  const entry = vault.entries.find(e => e.id === id);
  if (!entry) throw new Error('Entry not found');

  if (typeof label !== 'undefined') entry.label = label;
  if (typeof loginUrl !== 'undefined') entry.loginUrl = loginUrl;
  if (typeof passwordChangeUrl !== 'undefined') entry.passwordChangeUrl = passwordChangeUrl;
  if (typeof username !== 'undefined') entry.username = username;
  if (typeof email !== 'undefined') entry.email = email;
  if (typeof folder !== 'undefined') entry.folder = folder;
  if (typeof twoFactorEnabled !== 'undefined') entry.twoFactorEnabled = twoFactorEnabled;
  if (typeof iconName !== 'undefined') entry.iconName = iconName;
  if (typeof iconSource !== 'undefined') entry.iconSource = iconSource;
  if (typeof detectedService !== 'undefined') entry.detectedService = detectedService;
  entry.updatedAt = Date.now();

  await saveVault(vault);
  return entry;
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
  // Restaurar implica crear una versión nueva activa basada en una histórica.
  const vault = await loadVault();
  const idx = buildIndexes(vault.entries);
  const version = idx.byId.get(versionId);
  if (!version) return null;

  const latest = newestForChain(version, idx);
  const chain = chainFromNewest(latest, idx);
  const current = chain.find(e => e.active !== false) || latest;

  if (current.active !== false) {
    current.active = false;
  }

  const secret = version.secret || version.password || '';
  if (!secret || typeof secret !== 'string') return null;

  const hash = createHash('sha256').update(secret).digest('hex');
  const normalized = normalizePattern(secret);
  const now = Date.now();

  const restored: VaultEntry = {
    ...version,
    id: randomUUID(),
    previousId: latest.id,
    updatedAt: now,
    createdAt: version.createdAt,
    active: true,
    hash,
    normalized,
    secret,
    password: secret
  };

  vault.entries.push(restored);
  const maxHistory = await historyLimit();
  enforceHistoryLimit(vault, restored.id, maxHistory);
  await saveVault(vault);
  return restored;
}

export async function deleteHistoryVersion(id: string): Promise<boolean> {
  const vault = await loadVault();
  const entry = vault.entries.find(e => e.id === id);
  if (!entry) return false;
  if (entry.active !== false) {
    throw new Error('Cannot delete active version');
  }
  vault.entries = vault.entries.filter(e => e.id !== id);
  await saveVault(vault);
  return true;
}

export async function deleteHistoryForEntry(id: string): Promise<number> {
  const vault = await loadVault();
  const idx = buildIndexes(vault.entries);
  const entry = idx.byId.get(id);
  if (!entry) return 0;
  const latest = newestForChain(entry, idx);
  const chain = chainFromNewest(latest, idx);
  const keeper = chain.find(e => e.active !== false) || chain[0];
  const keepId = keeper.id;
  keeper.active = true;
  const removedIds = new Set(chain.map(e => e.id).filter(x => x !== keepId));
  vault.entries = vault.entries.filter(e => !removedIds.has(e.id));
  await saveVault(vault);
  return removedIds.size;
}

export async function compactVault(opts?: { keepOnlyCurrent?: boolean; maxHistoryPerEntry?: number }): Promise<{ removed: number; kept: number; chains: number }> {
  // Compacta historial por cadena según estrategia elegida.
  const vault = await loadVault();
  const chains = collectChains(vault.entries);
  const removedIds = new Set<string>();
  const limit = Math.max(1, opts?.maxHistoryPerEntry ?? (await historyLimit()));

  for (const chain of chains) {
    const current = chain.find(e => e.active !== false) || chain[0];
    if (opts?.keepOnlyCurrent) {
      for (const e of chain) {
        if (e.id !== current.id) removedIds.add(e.id);
      }
      current.active = true;
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
}

export async function getHistorySettings(): Promise<{ maxHistoryPerEntry: number }> {
  return await loadSettings();
}

export async function updateHistorySettings(maxHistoryPerEntry: number): Promise<{ maxHistoryPerEntry: number }> {
  return await saveSettings({ maxHistoryPerEntry });
}

async function dataForExport(includeHistory: boolean): Promise<VaultData> {
  // Permite exportar solo estado vigente o incluir historial completo.
  const vault = await loadVault();
  if (includeHistory) return vault;

  const chains = collectChains(vault.entries);
  const trimmed: VaultEntry[] = [];
  for (const chain of chains) {
    const current = chain.find(e => e.active !== false) || chain[0];
    trimmed.push(current);
  }
  return { entries: trimmed };
}

export async function exportEncryptedVault(includeHistory = true): Promise<Buffer> {
  const data = await dataForExport(includeHistory);
  const json = JSON.stringify(data);
  return encryptVault(json);
}

export async function exportVaultWithPassword(password: string, includeHistory = true): Promise<{ format: string; enc: 'master'; iterations: number; salt: string; data: string }> {
  const data = await dataForExport(includeHistory);
  const json = JSON.stringify(data);
  const { salt, iterations, data: encData } = encryptWithPassword(json, password);
  return { format: 'keyping-export-v2', enc: 'master', iterations, salt, data: encData };
}

export async function parseImportPayload(raw: string, password?: string): Promise<{ entries: ImportEntry[]; source: 'encrypted' | 'plain' | 'master'; requiresPassword?: boolean; masterPayload?: any }> {
  // Detecta automáticamente formato de import (v2 master, v1 native o JSON plano).
  const parsed = JSON.parse(raw);

  if (parsed?.format === 'keyping-export-v2' && parsed?.enc === 'master') {
    if (!password) {
      return { entries: [], source: 'master', requiresPassword: true, masterPayload: parsed };
    }
    const decrypted = decryptWithPassword(parsed, password);
    const data = JSON.parse(decrypted) as VaultData;
    if (!Array.isArray(data?.entries)) throw new Error('Archivo invalido');
    return { entries: data.entries as ImportEntry[], source: 'master' };
  }

  if (parsed?.format === 'keyping-export-v1' && typeof parsed?.vault === 'string') {
    const buf = Buffer.from(parsed.vault, 'base64');
    const json = await decryptVault(buf);
    const data = JSON.parse(json) as VaultData;
    if (!Array.isArray(data?.entries)) throw new Error('Invalid export payload');
    return { entries: data.entries as ImportEntry[], source: 'encrypted' };
  }

  if (Array.isArray(parsed?.entries)) {
    return { entries: parsed.entries as ImportEntry[], source: 'plain' };
  }

  if (Array.isArray(parsed)) {
    return { entries: parsed as ImportEntry[], source: 'plain' };
  }

  throw new Error('Archivo de import no reconocido');
}

export async function overwriteVaultWithEntries(entries: ImportEntry[]): Promise<number> {
  const mapped = entries
    .map(e => mapImportedEntry(e))
    .filter((e): e is VaultEntry => !!e);
  await saveVault({ entries: mapped });
  return mapped.length;
}

export async function importVaultFromEncrypted(base64: string): Promise<number> {
  const buf = Buffer.from(base64, 'base64');
  const json = await decryptVault(buf);
  const data = JSON.parse(json) as VaultData;
  if (!Array.isArray(data?.entries)) throw new Error('Archivo de export invalido');
  await saveVault({ entries: data.entries as VaultEntry[] });
  return data.entries.length;
}

export async function importVaultFromMasterEncrypted(payload: { format: string; enc: 'master'; iterations: number; salt: string; data: string }, password: string): Promise<number> {
  const json = decryptWithPassword(payload, password);
  const data = JSON.parse(json) as VaultData;
  if (!Array.isArray(data?.entries)) throw new Error('Archivo de export invalido');
  await saveVault({ entries: data.entries as VaultEntry[] });
  return data.entries.length;
}

export async function mergeVaultEntries(entries: ImportEntry[]): Promise<number> {
  // Merge simple: inserta entradas mapeadas sin deduplicación agresiva.
  const vault = await loadVault();
  let count = 0;
  for (const raw of entries) {
    const mapped = mapImportedEntry(raw);
    if (!mapped) continue;
    vault.entries.push(mapped);
    count++;
  }
  await saveVault(vault);
  return count;
}

function mapImportedEntry(raw: ImportEntry): VaultEntry | null {
  // Normaliza entradas heterogéneas de import al modelo interno del vault.
  const pwd = (raw.password || raw.secret || (raw as any).pwd || '') as string;
  if (!pwd || typeof pwd !== 'string') return null;

  const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : Date.now();
  const updatedAt = typeof raw.updatedAt === 'number' ? raw.updatedAt : createdAt;

  return {
    id: randomUUID(),
    createdAt,
    updatedAt,
    twoFactorEnabled: !!raw.twoFactorEnabled,
    length: pwd.length,
    classMask: classMask(pwd),
    hash: createHash('sha256').update(pwd).digest('hex'),
    secret: pwd,
    normalized: normalizePattern(pwd),
    label: raw.label,
    password: pwd,
    active: raw.active !== false,
    previousId: raw.previousId,
    loginUrl: raw.loginUrl,
    passwordChangeUrl: raw.passwordChangeUrl,
    username: raw.username,
    email: raw.email,
    folder: raw.folder,
    iconName: raw.iconName,
    iconSource: raw.iconSource,
    detectedService: raw.detectedService
  };
}

function encryptWithPassword(plain: string, password: string): { salt: string; iterations: number; data: string } {
  // Cifrado portable para export v2 (password-based, independiente del dispositivo).
  const iterations = 150_000;
  const salt = randomBytes(16);
  const key = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, tag, enc]).toString('base64');
  return { salt: salt.toString('base64'), iterations, data: combined };
}

function decryptWithPassword(payload: { salt: string; iterations: number; data: string }, password: string): string {
  // Decrypt simétrico del formato export v2.
  const salt = Buffer.from(payload.salt, 'base64');
  const key = pbkdf2Sync(password, salt, payload.iterations || 150_000, 32, 'sha256');
  const combined = Buffer.from(payload.data, 'base64');
  const iv = combined.subarray(0, 12);
  const tag = combined.subarray(12, 28);
  const cipher = combined.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(cipher), decipher.final()]).toString('utf8');
  return dec;
}

export { checkVaultIntegrity };
export type {
  VaultIntegrityReport,
  VaultIntegrityIssue,
  VaultIntegrityIssueCode,
  VaultIntegrityStatus
} from './types';


