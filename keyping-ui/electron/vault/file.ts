import { promises as fs } from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { encryptVault, decryptVault } from './crypto';
import { VaultData, VaultEntry } from './types';

function vaultPath(): string {
  return path.join(app.getPath('userData'), 'keyping-vault.kp');
}

function migrate(data: any): VaultData {
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
