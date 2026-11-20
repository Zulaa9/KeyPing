// Operaciones de negocio de la bóveda (núcleo compartido): altas, edición versionada,
// historial, compactación, exportación e importación. El almacenamiento cifrado, el hash
// con clave y la exclusión mutua los aporta cada plataforma (escritorio: electron/vault;
// móvil: src/app/platform/mobile).
import type { VaultData, VaultEntry } from './types';
import { normalizePattern } from './similarity';
import {
  HASH_VERSION,
  EntryMetaInput,
  ImportEntry,
  buildIndexes,
  chainFromNewest,
  classMask,
  collectChains,
  dataForExport,
  enforceHistoryLimit,
  mapImportedEntries,
  newestForChain,
  sanitizeMeta,
  validateSecret
} from './vault-model';
import { limitImport } from './export-format';

export type VaultOpsDeps = {
  load(): Promise<VaultData>;
  save(data: VaultData): Promise<void>;
  /** Hash con clave de la bóveda (HMAC-SHA256 en hexadecimal). */
  hasher(): Promise<(secret: string) => string>;
  uuid(): string;
  now?(): number;
  historyLimit(): Promise<number>;
  /** Exclusión mutua de las operaciones de lectura-modificación-escritura. */
  lock<T>(fn: () => Promise<T>): Promise<T>;
};

export class VaultOps {
  constructor(private readonly deps: VaultOpsDeps) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  async add(pwdInput: string, metaInput: EntryMetaInput = {}): Promise<VaultEntry> {
    const pwd = validateSecret(pwdInput);
    const meta = sanitizeMeta(metaInput);
    return this.deps.lock(async () => {
      const hash = await this.deps.hasher();
      const now = this.now();
      const entry: VaultEntry = {
        id: this.deps.uuid(),
        createdAt: now,
        updatedAt: now,
        twoFactorEnabled: !!meta.twoFactorEnabled,
        length: pwd.length,
        classMask: classMask(pwd),
        hash: hash(pwd),
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

      const vault = await this.deps.load();
      if (!vault.hashVersion) vault.hashVersion = HASH_VERSION;
      vault.entries.push(entry);
      await this.deps.save(vault);
      return entry;
    });
  }

  async entries(): Promise<VaultEntry[]> {
    return (await this.deps.load()).entries;
  }

  async softDelete(id: string): Promise<void> {
    return this.deps.lock(async () => {
      const vault = await this.deps.load();
      const entry = vault.entries.find(e => e.id === id);
      if (!entry) return;
      entry.active = false;
      await this.deps.save(vault);
    });
  }

  /**
   * Sustituye la contraseña de una entrada creando una versión nueva y dejando la anterior en el
   * historial. Si la contraseña es idéntica a la actual no crea versión (devuelve la entrada tal cual).
   */
  async replacePassword(id: string, newPwdInput: string): Promise<VaultEntry | null> {
    const newPwd = validateSecret(newPwdInput);
    return this.deps.lock(async () => {
      const vault = await this.deps.load();
      const idx = buildIndexes(vault.entries);
      const target = idx.byId.get(id);
      if (!target) return null;
      // Opera siempre sobre la versión más reciente de la cadena para no crear ramas en el historial.
      const old = newestForChain(target, idx);
      if (old.secret === newPwd && old.active !== false) return old;

      old.active = false;

      const hash = await this.deps.hasher();
      const newEntry: VaultEntry = {
        ...old,
        id: this.deps.uuid(),
        createdAt: old.createdAt,
        updatedAt: this.now(),
        twoFactorEnabled: old.twoFactorEnabled,
        length: newPwd.length,
        classMask: classMask(newPwd),
        hash: hash(newPwd),
        normalized: normalizePattern(newPwd),
        secret: newPwd,
        active: true,
        previousId: old.id
      };

      vault.entries.push(newEntry);
      enforceHistoryLimit(vault, newEntry.id, await this.deps.historyLimit());
      await this.deps.save(vault);
      return newEntry;
    });
  }

  async passwordPlain(id: string): Promise<string | null> {
    const vault = await this.deps.load();
    const entry = vault.entries.find(e => e.id === id);
    return entry?.secret ?? null;
  }

  async passwordHashes(): Promise<{ id: string; hash: string }[]> {
    const hash = await this.deps.hasher();
    const vault = await this.deps.load();
    return vault.entries
      .filter(e => e.active !== false)
      .map(e => ({
        id: e.id,
        hash: e.secret ? hash(e.secret) : e.hash
      }));
  }

  async updateMeta(id: string, metaInput: EntryMetaInput): Promise<VaultEntry> {
    const meta = sanitizeMeta(metaInput);
    return this.deps.lock(async () => {
      const vault = await this.deps.load();
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
      entry.updatedAt = this.now();

      await this.deps.save(vault);
      return entry;
    });
  }

  async history(id: string): Promise<VaultEntry[]> {
    const vault = await this.deps.load();
    const idx = buildIndexes(vault.entries);
    const entry = idx.byId.get(id);
    if (!entry) return [];
    const latest = newestForChain(entry, idx);
    return chainFromNewest(latest, idx);
  }

  async restoreVersion(versionId: string): Promise<VaultEntry | null> {
    return this.deps.lock(async () => {
      const vault = await this.deps.load();
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

      const hash = await this.deps.hasher();
      const restored: VaultEntry = {
        // Conserva los metadatos actuales (enlaces, carpeta, icono...) y recupera solo la contraseña.
        ...latest,
        id: this.deps.uuid(),
        previousId: latest.id,
        updatedAt: this.now(),
        createdAt: latest.createdAt,
        active: true,
        length: secret.length,
        classMask: classMask(secret),
        hash: hash(secret),
        normalized: normalizePattern(secret),
        secret
      };

      vault.entries.push(restored);
      enforceHistoryLimit(vault, restored.id, await this.deps.historyLimit());
      await this.deps.save(vault);
      return restored;
    });
  }

  async deleteVersion(id: string): Promise<boolean> {
    return this.deps.lock(async () => {
      const vault = await this.deps.load();
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
      await this.deps.save(vault);
      return true;
    });
  }

  async clearHistory(id: string): Promise<number> {
    return this.deps.lock(async () => {
      const vault = await this.deps.load();
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
      await this.deps.save(vault);
      return removedIds.size;
    });
  }

  async compact(opts?: { keepOnlyCurrent?: boolean; maxHistoryPerEntry?: number }): Promise<{ removed: number; kept: number; chains: number }> {
    return this.deps.lock(async () => {
      const vault = await this.deps.load();
      const chains = collectChains(vault.entries);
      const removedIds = new Set<string>();
      const requested = typeof opts?.maxHistoryPerEntry === 'number' && Number.isFinite(opts.maxHistoryPerEntry)
        ? opts.maxHistoryPerEntry
        : await this.deps.historyLimit();
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
        await this.deps.save(vault);
      }

      return { removed: removedIds.size, kept: vault.entries.length, chains: chains.length };
    });
  }

  /** JSON que va cifrado dentro del archivo de exportación. */
  async exportJson(includeHistory = true): Promise<string> {
    return JSON.stringify(dataForExport(await this.deps.load(), includeHistory));
  }

  async overwrite(entries: ImportEntry[]): Promise<number> {
    if (!Array.isArray(entries)) throw new Error('invalid-import-file');
    return this.deps.lock(async () => {
      const hash = await this.deps.hasher();
      const mapped = mapImportedEntries(limitImport(entries), hash, () => this.deps.uuid(), { keepIds: true }, () => this.now());
      await this.deps.save({ entries: mapped, hashVersion: HASH_VERSION });
      return mapped.filter(e => e.active !== false).length;
    });
  }

  async merge(entries: ImportEntry[]): Promise<number> {
    if (!Array.isArray(entries)) throw new Error('invalid-import-file');
    return this.deps.lock(async () => {
      const hash = await this.deps.hasher();
      const vault = await this.deps.load();
      const mapped = mapImportedEntries(limitImport(entries), hash, () => this.deps.uuid(), { keepIds: false }, () => this.now());
      vault.entries.push(...mapped);
      if (!vault.hashVersion) vault.hashVersion = HASH_VERSION;
      await this.deps.save(vault);
      return mapped.filter(e => e.active !== false).length;
    });
  }
}
