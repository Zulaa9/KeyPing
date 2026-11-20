// Modelo de la bóveda (núcleo compartido): validación, historial encadenado, mapeo de
// importaciones y datos de exportación. Sin E/S ni criptografía de plataforma: el hash de cada
// entrada y los identificadores se inyectan.
import type { VaultData, VaultEntry } from './types';
import { normalizeStoredUrl, tryNormalizeStoredUrl } from './url-utils';
import { normalizePattern } from './similarity';

export const HASH_VERSION = 'hmac-sha256-v1';
export const MAX_SECRET_LENGTH = 4096;
export const MAX_TEXT_LENGTH = 512;
export const MAX_FOLDER_LENGTH = 256;
export const DEFAULT_MAX_HISTORY = 20;

export type ImportEntry = Partial<VaultEntry> & { password?: string; secret?: string };

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

export type SecretHasher = (secret: string) => string;
export type IdFactory = () => string;

export class VaultUnreadableError extends Error {
  readonly code = 'VAULT_UNREADABLE';
  constructor(readonly reason: 'too-short' | 'decrypt-failed' | 'invalid-json' | 'invalid-structure' | 'read-error') {
    super(`Vault unreadable (${reason})`);
    this.name = 'VaultUnreadableError';
  }
}

export function classMask(s: string): number {
  let m = 0;
  if (/[a-z]/.test(s)) m |= 1;
  if (/[A-Z]/.test(s)) m |= 2;
  if (/\d/.test(s))   m |= 4;
  if (/[^A-Za-z0-9]/.test(s)) m |= 8;
  return m;
}

// ---- Validación ----

export function optText(value: unknown, max = MAX_TEXT_LENGTH): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

export function optIconSource(value: unknown): 'auto' | 'manual' | undefined {
  return value === 'auto' || value === 'manual' ? value : undefined;
}

export function optTimestamp(value: unknown): number | undefined {
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

// ---- Lectura del JSON de la bóveda ----

const MIN_TIMESTAMP_MS = new Date('2010-01-01').getTime();
const MAX_FUTURE_DRIFT_MS = 365 * 24 * 60 * 60 * 1000; // tolerancia de 1 ano

/** Migraciones de esquema al cargar para mantener compatibilidad hacia atrás. */
export function migrateVault(data: any, uuid: IdFactory): VaultData {
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
      e.id = uuid();
    }
    if (typeof e.active === 'undefined') {
      e.active = true;
    }
  }

  return { entries };
}

export function parseVaultJson(json: string, uuid: IdFactory): VaultData {
  let raw: any;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new VaultUnreadableError('invalid-json');
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.entries)) {
    throw new VaultUnreadableError('invalid-structure');
  }
  const data = migrateVault(raw, uuid);
  if (typeof raw.hashVersion === 'string') data.hashVersion = raw.hashVersion;
  return data;
}

export function isPlausibleTimestamp(ts: any, now: number): boolean {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return false;
  if (ts < MIN_TIMESTAMP_MS) return false;
  if (ts > now + MAX_FUTURE_DRIFT_MS) return false;
  return true;
}

// ---- Historial encadenado (previousId) ----

export type Indexes = {
  byId: Map<string, VaultEntry>;
  childByPrev: Map<string, VaultEntry>;
};

export function buildIndexes(entries: VaultEntry[]): Indexes {
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

export function newestForChain(start: VaultEntry, idx: Indexes): VaultEntry {
  let cur = start;
  const seen = new Set<string>();
  while (idx.childByPrev.has(cur.id) && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = idx.childByPrev.get(cur.id)!;
  }
  return cur;
}

export function chainFromNewest(latest: VaultEntry, idx: Indexes): VaultEntry[] {
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

export function collectChains(entries: VaultEntry[]): VaultEntry[][] {
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

export function enforceHistoryLimit(
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

// ---- Exportación e importación ----

/** Datos que se exportan: toda la bóveda o solo la versión vigente de cada cadena. */
export function dataForExport(vault: VaultData, includeHistory: boolean): VaultData {
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

/**
 * Convierte entradas importadas en entradas de vault válidas.
 * - Recalcula hash, longitud, máscara y patrón desde el secreto (no se confía en el archivo).
 * - Descarta entradas sin contraseña y enlaces no seguros.
 * - `keepIds`: conserva ids (restaurar una exportación propia). Si no, genera ids nuevos y
 *   re-enlaza `previousId` dentro del lote para que el historial siga encadenado y no apunte
 *   a entradas ajenas ya presentes en la bóveda.
 */
export function mapImportedEntries(
  rawEntries: ImportEntry[],
  hash: SecretHasher,
  uuid: IdFactory,
  opts: { keepIds: boolean },
  now: () => number = Date.now
): VaultEntry[] {
  const idMap = new Map<string, string>();
  const usedIds = new Set<string>();
  for (const raw of rawEntries) {
    const oldId = typeof raw.id === 'string' && raw.id ? raw.id : null;
    if (!oldId || idMap.has(oldId)) continue;
    const newId = opts.keepIds && !usedIds.has(oldId) ? oldId : uuid();
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
    let id = oldId ? idMap.get(oldId)! : uuid();
    if (seen.has(id)) id = uuid();
    seen.add(id);

    const prevRaw = typeof raw.previousId === 'string' ? raw.previousId : undefined;
    const previousId = prevRaw ? idMap.get(prevRaw) : undefined;

    const createdAt = optTimestamp(raw.createdAt) ?? now();
    const updatedAt = optTimestamp(raw.updatedAt) ?? createdAt;

    out.push({
      id,
      createdAt,
      updatedAt,
      twoFactorEnabled: !!raw.twoFactorEnabled,
      length: pwd.length,
      classMask: classMask(pwd),
      hash: hash(pwd),
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
