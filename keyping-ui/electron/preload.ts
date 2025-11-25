import { contextBridge, ipcRenderer } from 'electron';

console.log('[preload] loaded');

contextBridge.exposeInMainWorld('keyping', {
  ping: () => ipcRenderer.invoke('keyping:ping'),

  checkCandidate: (pwd: string) => {
    console.log('[preload] invoking keyping:check');
    return ipcRenderer.invoke('keyping:check', { pwd });
  },

  savePassword: (pwd: string, label?: string, loginUrl?: string, passwordChangeUrl?: string, username?: string, email?: string) =>
    ipcRenderer.invoke('keyping:save', { pwd, label, loginUrl, passwordChangeUrl, username, email }),

  listPasswords: () =>
    ipcRenderer.invoke('keyping:list'),

  copyPassword: (id: string) =>
    ipcRenderer.invoke('keyping:copy', { id }),

  deletePassword: (id: string) =>
    ipcRenderer.invoke('keyping:delete', { id }),

  updatePassword: (id: string, pwd: string) =>
    ipcRenderer.invoke('keyping:update', { id, pwd }),
  
  updateMeta: (id: string, label: string, loginUrl: string, passwordChangeUrl: string, username?: string, email?: string) =>
    ipcRenderer.invoke('keyping:updateMeta', { id, label, loginUrl, passwordChangeUrl, username, email }),
  
  getPassword: (id: string) =>
    ipcRenderer.invoke('keyping:getPassword', { id }),

  openExternal: (url: string) =>
    ipcRenderer.invoke('keyping:openExternal', url),
});
