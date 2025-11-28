import { contextBridge, ipcRenderer } from 'electron';

console.log('[preload] loaded');

contextBridge.exposeInMainWorld('keyping', {
  ping: () => ipcRenderer.invoke('keyping:ping'),

  checkCandidate: (pwd: string) => {
    console.log('[preload] invoking keyping:check');
    return ipcRenderer.invoke('keyping:check', { pwd });
  },

  savePassword: (pwd: string, label?: string, loginUrl?: string, passwordChangeUrl?: string, username?: string, email?: string, folder?: string, twoFactorEnabled?: boolean) =>
    ipcRenderer.invoke('keyping:save', { pwd, label, loginUrl, passwordChangeUrl, username, email, folder, twoFactorEnabled }),

  listPasswords: () =>
    ipcRenderer.invoke('keyping:list'),

  copyPassword: (id: string) =>
    ipcRenderer.invoke('keyping:copy', { id }),

  deletePassword: (id: string) =>
    ipcRenderer.invoke('keyping:delete', { id }),

  updatePassword: (id: string, pwd: string) =>
    ipcRenderer.invoke('keyping:update', { id, pwd }),
  
  updateMeta: (id: string, label: string, loginUrl: string, passwordChangeUrl: string, username?: string, email?: string, folder?: string, twoFactorEnabled?: boolean) =>
    ipcRenderer.invoke('keyping:updateMeta', { id, label, loginUrl, passwordChangeUrl, username, email, folder, twoFactorEnabled }),
  
  getPassword: (id: string) =>
    ipcRenderer.invoke('keyping:getPassword', { id }),

  openExternal: (url: string) =>
    ipcRenderer.invoke('keyping:openExternal', url),

  exportVault: () =>
    ipcRenderer.invoke('keyping:exportVault'),

  parseImport: (raw: string) =>
    ipcRenderer.invoke('keyping:parseImport', raw),

  importVault: (mode: 'overwrite' | 'merge', entries: any[], encrypted?: string) =>
    ipcRenderer.invoke('keyping:importVault', { mode, entries, encrypted }),
});
