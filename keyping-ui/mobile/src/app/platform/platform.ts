// Plataforma móvil con Capacitor. Los datos viven en el almacenamiento interno privado de la app
// (Context.getFilesDir()/keyping) a través del plugin nativo KeypingNative; no hay red.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { installMobileBridge, notifyPaused } from './mobile-bridge';

type KeypingNativePlugin = {
  readFile(o: { name: string }): Promise<{ data: string | null }>;
  writeFile(o: { name: string; data: string }): Promise<void>;
  deleteFile(o: { name: string }): Promise<void>;
  copySensitive(o: { text: string; ttlMs: number }): Promise<{ ok: boolean }>;
  clearClipboardIfOwned(): Promise<void>;
  openExternal(o: { url: string }): Promise<{ ok: boolean }>;
  saveFile(o: { filename: string; data: string }): Promise<{ ok: boolean }>;
  shareFile(o: { filename: string; data: string }): Promise<{ ok: boolean }>;
  pickFile(): Promise<{ ok: boolean; name?: string; data?: string; error?: 'too-large' | 'read-error' }>;
  addListener(event: 'paused', fn: () => void): Promise<unknown>;
};

const Native = registerPlugin<KeypingNativePlugin>('KeypingNative');

export const PLATFORM_TARGET = 'mobile' as const;

export async function installPlatform(): Promise<void> {
  installMobileBridge(
    Capacitor.getPlatform(),
    {
      read: async name => (await Native.readFile({ name })).data,
      write: async (name, data) => { await Native.writeFile({ name, data }); },
      remove: async name => { await Native.deleteFile({ name }); }
    },
    {
      copySensitive: async (text, ttlMs) => (await Native.copySensitive({ text, ttlMs })).ok,
      // En el móvil la app se bloquea en cuanto pasa a segundo plano, que es justo cuando se va a pegar
      // en otra app: el portapapeles no se vacía al bloquear, solo a los 20 s (copySensitive).
      clearClipboardIfOwned: async () => {},
      openExternal: async url => (await Native.openExternal({ url })).ok
    },
    {
      saveExportFile: async (filename, data, how) =>
        (how === 'share' ? await Native.shareFile({ filename, data }) : await Native.saveFile({ filename, data })).ok,
      pickImportFile: async () => {
        const r = await Native.pickFile();
        if (r.ok && typeof r.data === 'string') return { name: r.name || '', text: r.data };
        return r.error ? { error: r.error } : null;
      }
    }
  );
  // onPause de la actividad (por si el WebView no llega a emitir visibilitychange).
  await Native.addListener('paused', () => notifyPaused());
}
