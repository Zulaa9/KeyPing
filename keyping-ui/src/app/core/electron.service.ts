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
};

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
    twoFactorEnabled?: boolean
  ): Promise<PasswordMeta>;
  listPasswords(): Promise<PasswordMeta[]>;
  copyPassword(id: string): Promise<boolean>;
  deletePassword(id: string): Promise<boolean>;
  updatePassword(id: string, pwd: string): Promise<PasswordMeta>;
  updateMeta(id: string, label?: string, loginUrl?: string, passwordChangeUrl?: string, username?: string, email?: string, folder?: string, twoFactorEnabled?: boolean): Promise<PasswordMeta>;
  copySecure?(text: string, ttlMs?: number): Promise<boolean>;
  getPassword(id: string): Promise<string | null>;
  openExternal(url: string): Promise<boolean>;
  exportVault(mode?: 'native' | 'master', password?: string): Promise<{ base64?: string; payload?: any; filename: string; format: string; enc: string }>;
  parseImport(raw: string, password?: string): Promise<VaultImportPreview>;
  importVault(mode: 'overwrite' | 'merge', entries: VaultImportEntry[], encrypted?: string, enc?: 'native' | 'master' | 'plain', password?: string, masterPayload?: any): Promise<{ imported: number; overwritten: boolean }>;
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
    twoFactorEnabled?: boolean
  ): Promise<PasswordMeta> {
    if (!this.api) throw new Error('No preload API available');
    return this.api.savePassword(pwd, label, loginUrl, passwordChangeUrl, username, email, folder, twoFactorEnabled);
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
  async updateMeta(id: string, label?: string, loginUrl?: string, passwordChangeUrl?: string, username?: string, email?: string, folder?: string, twoFactorEnabled?: boolean): Promise<PasswordMeta> {
    if (!this.api || !this.api.updateMeta) {
      throw new Error('No preload API available');
    }
    return this.api.updateMeta(id, label, loginUrl, passwordChangeUrl, username, email, folder, twoFactorEnabled);
  }

  async openExternal(url: string): Promise<void> {
    if (!this.api) throw new Error('No preload API available');
    await this.api.openExternal(url);
  }

  async getPassword(id: string): Promise<string | null> {
    if (!this.api) throw new Error('No preload API available');
    return this.api.getPassword(id);
  }

  async exportVault(mode: 'native' | 'master', password?: string): Promise<{ base64?: string; payload?: any; filename: string; format: string; enc: string }> {
    if (!this.api || !this.api.exportVault) throw new Error('No preload API available');
    return this.api.exportVault(mode, password);
  }

  async parseImport(raw: string, password?: string): Promise<VaultImportPreview> {
    if (!this.api || !this.api.parseImport) throw new Error('No preload API available');
    return this.api.parseImport(raw, password);
  }

  async importVault(mode: 'overwrite' | 'merge', entries: VaultImportEntry[], encrypted?: string, enc?: 'native' | 'master' | 'plain', password?: string, masterPayload?: any): Promise<{ imported: number; overwritten: boolean }> {
    if (!this.api || !this.api.importVault) throw new Error('No preload API available');
    return this.api.importVault(mode, entries, encrypted, enc, password, masterPayload);
  }
}
