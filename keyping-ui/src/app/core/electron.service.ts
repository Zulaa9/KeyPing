import { Injectable } from '@angular/core';

export type CheckLevel = 'ok' | 'warn' | 'danger';

export type CheckResult = {
  level: CheckLevel;
  reasons: string[];
};

export type PasswordMeta = {
  id: string;
  createdAt: number;
  updatedAt?: number;
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
    email?: string
  ): Promise<PasswordMeta>;
  listPasswords(): Promise<PasswordMeta[]>;
  copyPassword(id: string): Promise<boolean>;
  deletePassword(id: string): Promise<boolean>;
  updatePassword(id: string, pwd: string): Promise<PasswordMeta>;
  updateMeta(id: string, label?: string, loginUrl?: string, passwordChangeUrl?: string, username?: string, email?: string): Promise<PasswordMeta>;
  copySecure?(text: string, ttlMs?: number): Promise<boolean>;
  getPassword(id: string): Promise<string | null>;
  openExternal(url: string): Promise<boolean>;
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
    email?: string
  ): Promise<PasswordMeta> {
    if (!this.api) throw new Error('No preload API available');
    return this.api.savePassword(pwd, label, loginUrl, passwordChangeUrl, username, email);
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
  async updateMeta(id: string, label?: string, loginUrl?: string, passwordChangeUrl?: string, username?: string, email?: string): Promise<PasswordMeta> {
    if (!this.api || !this.api.updateMeta) {
      throw new Error('No preload API available');
    }
    return this.api.updateMeta(id, label, loginUrl, passwordChangeUrl, username, email);
  }

  async openExternal(url: string): Promise<void> {
    if (!this.api) throw new Error('No preload API available');
    await this.api.openExternal(url);
  }

  async getPassword(id: string): Promise<string | null> {
    if (!this.api) throw new Error('No preload API available');
    return this.api.getPassword(id);
  }
}
