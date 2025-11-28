// electron/vault/index.ts
import { randomUUID, createHash } from 'crypto';
import { loadVault, saveVault } from './file';
import type { VaultEntry, VaultData } from './types';
import { normalizePattern } from './similarity';
import { encryptVault, decryptVault } from './crypto';

function classMask(s: string): number {
  let m = 0;
  if (/[a-z]/.test(s)) m |= 1;
  if (/[A-Z]/.test(s)) m |= 2;
  if (/\d/.test(s))   m |= 4;
  if (/[^A-Za-z0-9]/.test(s)) m |= 8;
  return m;
}

export async function addPasswordToVault(
  pwd: string,
  label?: string,
  loginUrl?: string,
  passwordChangeUrl?: string,
  username?: string,
  email?: string,
  folder?: string,
  twoFactorEnabled?: boolean
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
    folder
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
  await saveVault(vault);

  return newEntry;
}

export async function getPasswordPlain(id: string): Promise<string | null> {
  const vault = await loadVault();
  const entry = vault.entries.find(e => e.id === id && e.active !== false);
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
  twoFactorEnabled?: boolean
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
  entry.updatedAt = Date.now();

  await saveVault(vault);
  return entry;
}

export type ImportEntry = Partial<VaultEntry> & { password?: string; secret?: string };

export async function exportEncryptedVault(): Promise<Buffer> {
  const vault = await loadVault();
  const json = JSON.stringify(vault);
  return encryptVault(json);
}

export async function parseImportPayload(raw: string): Promise<{ entries: ImportEntry[]; source: 'encrypted' | 'plain' }> {
  const parsed = JSON.parse(raw);

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

export async function mergeVaultEntries(entries: ImportEntry[]): Promise<number> {
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
    folder: raw.folder
  };
}


