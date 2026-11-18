// Doble de prueba de `window.keyping` (preload) para los tests de Angular.
// Solo datos ficticios en memoria; nunca toca disco ni Electron.
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

export type FakeEntry = {
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
  folder?: string;
  detectedService?: string;
};

export function fakeEntry(partial: Partial<FakeEntry> & { id: string }): FakeEntry {
  return { createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000, length: 16, classMask: 15, ...partial };
}

export function installFakeKeyping(entries: FakeEntry[] = [], overrides: Record<string, any> = {}): Record<string, jasmine.Spy> {
  const api: Record<string, any> = {
    platform: 'linux',
    hasVault: jasmine.createSpy('hasVault').and.resolveTo(true),
    listPasswords: jasmine.createSpy('listPasswords').and.callFake(async () => entries.map(e => ({ ...e }))),
    getPasswordHashes: jasmine.createSpy('getPasswordHashes').and.resolveTo([]),
    getPasswordHistory: jasmine.createSpy('getPasswordHistory').and.resolveTo([]),
    openExternal: jasmine.createSpy('openExternal').and.resolveTo(true),
    savePassword: jasmine.createSpy('savePassword').and.callFake(async (pwd: string, label?: string) => fakeEntry({ id: 'new', label, length: pwd.length })),
    updatePassword: jasmine.createSpy('updatePassword').and.callFake(async (id: string) => fakeEntry({ id: id + '-v2' })),
    updateMeta: jasmine.createSpy('updateMeta').and.callFake(async (id: string, label?: string, loginUrl?: string, passwordChangeUrl?: string) => fakeEntry({ id, label, loginUrl, passwordChangeUrl })),
    checkCandidate: jasmine.createSpy('checkCandidate').and.resolveTo({ level: 'ok', reasons: [], codes: [] }),
    copyPassword: jasmine.createSpy('copyPassword').and.resolveTo(true),
    copyText: jasmine.createSpy('copyText').and.resolveTo(true),
    getPassword: jasmine.createSpy('getPassword').and.resolveTo(null),
    authUnlock: jasmine.createSpy('authUnlock').and.resolveTo({ ok: true }),
    authSetup: jasmine.createSpy('authSetup').and.resolveTo({ ok: true }),
    authChange: jasmine.createSpy('authChange').and.resolveTo({ ok: true }),
    authVerify: jasmine.createSpy('authVerify').and.resolveTo(true),
    sessionLock: jasmine.createSpy('sessionLock').and.resolveTo(undefined),
    getMainCooldown: jasmine.createSpy('getMainCooldown').and.resolveTo({ failedAttempts: 0, nextUnlockAt: 0, remainingMs: 0 }),
    setAttemptPolicy: jasmine.createSpy('setAttemptPolicy').and.resolveTo(undefined),
    onSessionLocked: jasmine.createSpy('onSessionLocked').and.returnValue(() => {}),
    parseImport: jasmine.createSpy('parseImport').and.resolveTo({ entries: [], source: 'plain' }),
    importVault: jasmine.createSpy('importVault').and.resolveTo({ imported: 0, overwritten: false }),
    getHistorySettings: jasmine.createSpy('getHistorySettings').and.resolveTo({ maxHistoryPerEntry: 20 }),
    checkVaultIntegrity: jasmine.createSpy('checkVaultIntegrity').and.resolveTo({ status: 'ok', fileExists: true, issues: [], checkedAt: 0 }),
    getUpdateState: jasmine.createSpy('getUpdateState').and.resolveTo({ status: 'idle', currentVersion: '1.2.0' }),
    getUpdatePreferences: jasmine.createSpy('getUpdatePreferences').and.resolveTo({ autoCheck: false, autoDownload: false, installOnQuit: false }),
    onUpdateState: jasmine.createSpy('onUpdateState').and.returnValue(() => {}),
    minimizeWindow: jasmine.createSpy('minimizeWindow'),
    maximizeWindow: jasmine.createSpy('maximizeWindow'),
    closeWindow: jasmine.createSpy('closeWindow'),
    ...overrides
  };
  (window as any).keyping = api;
  return api as Record<string, jasmine.Spy>;
}

export function uninstallFakeKeyping(): void {
  delete (window as any).keyping;
}

export const testProviders = [provideRouter(['dashboard', 'passwords', 'add', 'health', 'settings'].map(path => ({ path, children: [] }))), provideHttpClient(), provideHttpClientTesting()];
