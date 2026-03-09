import { contextBridge, ipcRenderer } from 'electron';
import { UpdatePreferences, UpdateState } from './updates/types';

console.log('[preload] loaded');

// API segura expuesta al renderer (contextIsolation=true).
// Todo acceso a filesystem/IPC pasa por este puente tipado.
contextBridge.exposeInMainWorld('keyping', {
  ping: () => ipcRenderer.invoke('keyping:ping'),
  checkVaultIntegrity: () => ipcRenderer.invoke('keyping:vaultIntegrity'),
  getHistorySettings: () => ipcRenderer.invoke('keyping:getHistorySettings'),
  updateHistorySettings: (maxHistoryPerEntry: number) =>
    ipcRenderer.invoke('keyping:updateHistorySettings', maxHistoryPerEntry),
  compactVault: (keepOnlyCurrent?: boolean, maxHistoryPerEntry?: number) =>
    ipcRenderer.invoke('keyping:compactVault', { keepOnlyCurrent, maxHistoryPerEntry }),
  getPasswordHistory: (id: string) =>
    ipcRenderer.invoke('keyping:getPasswordHistory', { id }),
  restorePasswordVersion: (id: string) =>
    ipcRenderer.invoke('keyping:restorePasswordVersion', { id }),
  deletePasswordVersion: (id: string) =>
    ipcRenderer.invoke('keyping:deletePasswordVersion', { id }),
  clearPasswordHistory: (id: string) =>
    ipcRenderer.invoke('keyping:clearPasswordHistory', { id }),

  checkCandidate: (pwd: string) => {
    // Se mantiene log de trazabilidad para diagnósticos de IPC.
    console.log('[preload] invoking keyping:check');
    return ipcRenderer.invoke('keyping:check', { pwd });
  },

  savePassword: (
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
  ) =>
    ipcRenderer.invoke('keyping:save', {
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
    }),

  listPasswords: () =>
    ipcRenderer.invoke('keyping:list'),

  copyPassword: (id: string) =>
    ipcRenderer.invoke('keyping:copy', { id }),

  deletePassword: (id: string) =>
    ipcRenderer.invoke('keyping:delete', { id }),

  updatePassword: (id: string, pwd: string) =>
    ipcRenderer.invoke('keyping:update', { id, pwd }),
  
  updateMeta: (
    id: string,
    label: string,
    loginUrl: string,
    passwordChangeUrl: string,
    username?: string,
    email?: string,
    folder?: string,
    twoFactorEnabled?: boolean,
    iconName?: string,
    iconSource?: 'auto' | 'manual',
    detectedService?: string
  ) =>
    ipcRenderer.invoke('keyping:updateMeta', {
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
    }),
  
  getPassword: (id: string) =>
    ipcRenderer.invoke('keyping:getPassword', { id }),

  openExternal: (url: string) =>
    ipcRenderer.invoke('keyping:openExternal', url),

  exportVault: (mode?: 'native' | 'master', password?: string, includeHistory?: boolean) =>
    ipcRenderer.invoke('keyping:exportVault', { mode, password, includeHistory }),

  parseImport: (raw: string, password?: string) =>
    ipcRenderer.invoke('keyping:parseImport', raw, password),

  importVault: (mode: 'overwrite' | 'merge', entries: any[], encrypted?: string, enc?: 'native' | 'master' | 'plain', password?: string, masterPayload?: any) =>
    ipcRenderer.invoke('keyping:importVault', { mode, entries, encrypted, enc, password, masterPayload }),

  getUpdateState: (): Promise<UpdateState> =>
    ipcRenderer.invoke('keyping:update:getState'),

  getUpdatePreferences: (): Promise<UpdatePreferences> =>
    ipcRenderer.invoke('keyping:update:getPreferences'),

  setUpdatePreferences: (preferences: Partial<UpdatePreferences>): Promise<UpdatePreferences> =>
    ipcRenderer.invoke('keyping:update:setPreferences', preferences),

  checkForUpdates: (): Promise<UpdateState> =>
    ipcRenderer.invoke('keyping:update:check'),

  downloadUpdate: (): Promise<UpdateState> =>
    ipcRenderer.invoke('keyping:update:download'),

  installUpdateAndRestart: (): Promise<boolean> =>
    ipcRenderer.invoke('keyping:update:install'),

  postponeUpdate: (): Promise<UpdateState> =>
    ipcRenderer.invoke('keyping:update:postpone'),

  onUpdateState: (listener: (payload: UpdateState) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: UpdateState) => listener(payload);
    ipcRenderer.on('keyping:update:state', wrapped);
    return () => ipcRenderer.removeListener('keyping:update:state', wrapped);
  }
});
