// electron/vault/index.ts
import { randomUUID, createHash } from 'crypto';
import { loadVault, saveVault } from './file';
import type { VaultEntry } from './types';
import { normalizePattern } from './similarity';

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
  email?: string
): Promise<VaultEntry> {
  const hash = createHash('sha256').update(pwd).digest('hex');
  const normalized = normalizePattern(pwd);

  const entry: VaultEntry = {
    id: randomUUID(),
    createdAt: Date.now(),
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
    email
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
    createdAt: Date.now(),
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
  email?: string
): Promise<VaultEntry> {
  const vault = await loadVault();
  const entry = vault.entries.find(e => e.id === id);
  if (!entry) throw new Error('Entry not found');

  if (typeof label !== 'undefined') entry.label = label;
  if (typeof loginUrl !== 'undefined') entry.loginUrl = loginUrl;
  if (typeof passwordChangeUrl !== 'undefined') entry.passwordChangeUrl = passwordChangeUrl;
  if (typeof username !== 'undefined') entry.username = username;
  if (typeof email !== 'undefined') entry.email = email;

  await saveVault(vault);
  return entry;
}


