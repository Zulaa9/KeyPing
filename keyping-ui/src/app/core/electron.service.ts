import { Injectable } from '@angular/core';

export type CheckLevel = 'ok' | 'warn' | 'danger';

export type CheckResult = {
  level: CheckLevel;
  reasons: string[];
};

export type VaultImportEntry = {
  id?: string;
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
  password?: string;
  secret?: string;
  createdAt?: number;
  updatedAt?: number;
};

export type VaultImportPreview = {
  entries: VaultImportEntry[];
  source: 'encrypted' | 'plain' | 'master';
  requiresPassword?: boolean;
  masterPayload?: any;
};

export type PasswordMeta = {
  id: string;
  createdAt: number;
  updatedAt?: number;
  twoFactorEnabled?: boolean;
  folder?: string;
  length: number;
  classMask: number;
  label?: string;
  loginUrl?: string;
  passwordChangeUrl?: string;
  username?: string;
  email?: string;
  iconName?: string;
  iconSource?: 'auto' | 'manual';
  detectedService?: string;
  active?: boolean;
  previousId?: string;
};

export type VaultIntegrityIssueCode =
  | 'missing-file'
  | 'read-error'
  | 'invalid-header'
  | 'decrypt-failed'
  | 'invalid-json'
  | 'invalid-structure'
  | 'implausible-timestamps';

export type VaultIntegrityIssue = {
  code: VaultIntegrityIssueCode;
  count?: number;
  detail?: string;
};

export type VaultIntegrityStatus = 'ok' | 'warn' | 'error';

export type VaultIntegrityReport = {
  status: VaultIntegrityStatus;
  fileExists: boolean;
  issues: VaultIntegrityIssue[];
  entries?: number;
  checkedAt: number;
};

export type PasswordHistoryEntry = PasswordMeta;

type KeypingApi = {
  checkCandidate(pwd: string): Promise<CheckResult>;
  savePassword(
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
  ): Promise<PasswordMeta>;
  listPasswords(): Promise<PasswordMeta[]>;
  copyPassword(id: string): Promise<boolean>;
  deletePassword(id: string): Promise<boolean>;
  updatePassword(id: string, pwd: string): Promise<PasswordMeta>;
  updateMeta(
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
  ): Promise<PasswordMeta>;
  copySecure?(text: string, ttlMs?: number): Promise<boolean>;
  getPassword(id: string): Promise<string | null>;
  openExternal(url: string): Promise<boolean>;
  exportVault(mode?: 'native' | 'master', password?: string, includeHistory?: boolean): Promise<{ base64?: string; payload?: any; filename: string; format: string; enc: string }>;
  parseImport(raw: string, password?: string): Promise<VaultImportPreview>;
  importVault(mode: 'overwrite' | 'merge', entries: VaultImportEntry[], encrypted?: string, enc?: 'native' | 'master' | 'plain', password?: string, masterPayload?: any): Promise<{ imported: number; overwritten: boolean }>;
  getPasswordHistory(id: string): Promise<PasswordHistoryEntry[]>;
  restorePasswordVersion(id: string): Promise<PasswordHistoryEntry>;
  deletePasswordVersion(id: string): Promise<boolean>;
  clearPasswordHistory(id: string): Promise<number>;
  getHistorySettings(): Promise<{ maxHistoryPerEntry: number }>;
  updateHistorySettings(maxHistoryPerEntry: number): Promise<{ maxHistoryPerEntry: number }>;
  compactVault(keepOnlyCurrent?: boolean, maxHistoryPerEntry?: number): Promise<{ removed: number; kept: number; chains: number }>;
  checkVaultIntegrity(): Promise<VaultIntegrityReport>;
  ping?(): Promise<string>;
};

@Injectable({ providedIn: 'root' })
export class ElectronService {
  private get api(): KeypingApi | undefined {
    return (window as any).keyping as KeypingApi | undefined;
  }

  isElectron(): boolean {
    return !!this.api;
  }

  async checkCandidate(pwd: string): Promise<CheckResult> {
    if (!this.api) throw new Error('No preload API available');
    return this.api.checkCandidate(pwd);
  }

  async savePassword(
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
  ): Promise<PasswordMeta> {
    if (!this.api) throw new Error('No preload API available');
    return this.api.savePassword(
      pwd,
      label,
      loginUrl,
      passwordChangeUrl,
      username,
      email,
      folder,
      twoFactorEnabled,
      iconName,
      iconSource,
      detectedService
    );
  }

  async listPasswords(): Promise<PasswordMeta[]> {
    if (!this.api) throw new Error('No preload API available');
    return this.api.listPasswords();
  }

  async copyPassword(id: string): Promise<void> {
    if (!this.api) throw new Error('No preload API available');
    await this.api.copyPassword(id);
  }

  async deletePassword(id: string): Promise<void> {
    if (!this.api) throw new Error('No preload API available');
    await this.api.deletePassword(id);
  }

  async copySecure(text: string, ttlMs = 20_000): Promise<void> {
    if (!this.api || !this.api.copySecure) {
      throw new Error('Secure clipboard API not available');
    }
    await this.api.copySecure(text, ttlMs);
  }

  async updatePassword(id: string, pwd: string): Promise<PasswordMeta> {
    if (!this.api) throw new Error('No preload API available');
    return this.api.updatePassword(id, pwd);
  }
  async updateMeta(
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
  ): Promise<PasswordMeta> {
    if (!this.api || !this.api.updateMeta) {
      throw new Error('No preload API available');
    }
    return this.api.updateMeta(
      id,
      label,
      loginUrl,
      passwordChangeUrl,
      username,
      email,
      folder,
      twoFactorEnabled,
      iconName,
      iconSource,
      detectedService
    );
  }

  async openExternal(url: string): Promise<void> {
    if (!this.api) throw new Error('No preload API available');
    await this.api.openExternal(url);
  }

  async getPassword(id: string): Promise<string | null> {
    if (!this.api) throw new Error('No preload API available');
    return this.api.getPassword(id);
  }

  async exportVault(mode: 'native' | 'master', password?: string, includeHistory?: boolean): Promise<{ base64?: string; payload?: any; filename: string; format: string; enc: string }> {
    if (!this.api || !this.api.exportVault) throw new Error('No preload API available');
    return this.api.exportVault(mode, password, includeHistory);
  }

  async parseImport(raw: string, password?: string): Promise<VaultImportPreview> {
    if (!this.api || !this.api.parseImport) throw new Error('No preload API available');
    return this.api.parseImport(raw, password);
  }

  async importVault(mode: 'overwrite' | 'merge', entries: VaultImportEntry[], encrypted?: string, enc?: 'native' | 'master' | 'plain', password?: string, masterPayload?: any): Promise<{ imported: number; overwritten: boolean }> {
    if (!this.api || !this.api.importVault) throw new Error('No preload API available');
    return this.api.importVault(mode, entries, encrypted, enc, password, masterPayload);
  }

  async getPasswordHistory(id: string): Promise<PasswordHistoryEntry[]> {
    if (!this.api || !this.api.getPasswordHistory) throw new Error('No preload API available');
    return this.api.getPasswordHistory(id);
  }

  async restorePasswordVersion(id: string): Promise<PasswordHistoryEntry> {
    if (!this.api || !this.api.restorePasswordVersion) throw new Error('No preload API available');
    return this.api.restorePasswordVersion(id);
  }

  async deletePasswordVersion(id: string): Promise<boolean> {
    if (!this.api || !this.api.deletePasswordVersion) throw new Error('No preload API available');
    return this.api.deletePasswordVersion(id);
  }

  async clearPasswordHistory(id: string): Promise<number> {
    if (!this.api || !this.api.clearPasswordHistory) throw new Error('No preload API available');
    return this.api.clearPasswordHistory(id);
  }

  async getHistorySettings(): Promise<{ maxHistoryPerEntry: number }> {
    if (!this.api || !this.api.getHistorySettings) throw new Error('No preload API available');
    return this.api.getHistorySettings();
  }

  async updateHistorySettings(maxHistoryPerEntry: number): Promise<{ maxHistoryPerEntry: number }> {
    if (!this.api || !this.api.updateHistorySettings) throw new Error('No preload API available');
    return this.api.updateHistorySettings(maxHistoryPerEntry);
  }

  async compactVault(keepOnlyCurrent?: boolean, maxHistoryPerEntry?: number): Promise<{ removed: number; kept: number; chains: number }> {
    if (!this.api || !this.api.compactVault) throw new Error('No preload API available');
    return this.api.compactVault(keepOnlyCurrent, maxHistoryPerEntry);
  }

  async getVaultIntegrity(): Promise<VaultIntegrityReport> {
    if (!this.api || !this.api.checkVaultIntegrity) throw new Error('No preload API available');
    return this.api.checkVaultIntegrity();
  }
}
