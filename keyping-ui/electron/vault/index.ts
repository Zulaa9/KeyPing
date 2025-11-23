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

export async function addPasswordToVault(pwd: string, note?: string): Promise<VaultEntry> {
  const hash = createHash('sha256').update(pwd).digest('hex');
  const normalized = normalizePattern(pwd);

  const entry: VaultEntry = {
    id: randomUUID(),
    createdAt: Date.now(),
    length: pwd.length,
    classMask: classMask(pwd),
    hash,
    normalized,
    note
  };

  const vault = await loadVault();
  vault.entries.push(entry);
  await saveVault(vault);

  return entry;
}

export async function getVaultEntries() {
  return (await loadVault()).entries;
}
