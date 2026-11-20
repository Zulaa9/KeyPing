// Plataforma móvil con Capacitor. Los datos viven en el almacenamiento interno privado de la app
// (Context.getFilesDir()/keyping) a través del plugin nativo KeypingNative; no hay red.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { installMobileBridge } from './mobile-bridge';

type KeypingNativePlugin = {
  readFile(o: { name: string }): Promise<{ data: string | null }>;
  writeFile(o: { name: string; data: string }): Promise<void>;
  deleteFile(o: { name: string }): Promise<void>;
  copySensitive(o: { text: string; ttlMs: number }): Promise<{ ok: boolean }>;
  clearClipboardIfOwned(): Promise<void>;
  openExternal(o: { url: string }): Promise<{ ok: boolean }>;
  saveFile(o: { filename: string; data: string }): Promise<{ ok: boolean }>;
  shareFile(o: { filename: string; data: string }): Promise<{ ok: boolean }>;
  addListener(event: 'paused', fn: () => void): Promise<unknown>;
};

const Native = registerPlugin<KeypingNativePlugin>('KeypingNative');

export const PLATFORM_TARGET = 'mobile' as const;

export async function installPlatform(): Promise<void> {
  const service = installMobileBridge(
    Capacitor.getPlatform(),
    {
      read: async name => (await Native.readFile({ name })).data,
      write: async (name, data) => { await Native.writeFile({ name, data }); },
      remove: async name => { await Native.deleteFile({ name }); }
    },
    {
      copySensitive: async (text, ttlMs) => (await Native.copySensitive({ text, ttlMs })).ok,
      clearClipboardIfOwned: async () => { await Native.clearClipboardIfOwned(); },
      openExternal: async url => (await Native.openExternal({ url })).ok
    },
    {
      saveExportFile: async (filename, data, how) =>
        (how === 'share' ? await Native.shareFile({ filename, data }) : await Native.saveFile({ filename, data })).ok
    }
  );
  // onPause de la actividad (por si el WebView no llega a emitir visibilitychange).
  await Native.addListener('paused', () => service.lockNow(true));
}
