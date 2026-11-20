// Simulación de la plataforma móvil en un navegador (solo pruebas con Playwright y desarrollo).
// Mismo núcleo y misma capa que el móvil; los servicios nativos se sustituyen por equivalentes web
// y los datos van a localStorage con prefijo propio. Nunca se distribuye.
import { installMobileBridge } from './mobile-bridge';

const PREFIX = 'kp-sim:';

export const PLATFORM_TARGET = 'mobile-sim' as const;

export async function installPlatform(): Promise<void> {
  let owned: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const sim = ((window as any).__kpSim = { opened: [] as string[], clipboard: null as string | null, shared: [] as string[] });
  installMobileBridge(
    'mobile-sim',
    {
      read: async name => localStorage.getItem(PREFIX + name),
      write: async (name, data) => localStorage.setItem(PREFIX + name, data),
      remove: async name => localStorage.removeItem(PREFIX + name)
    },
    {
      copySensitive: async (text, ttlMs) => {
        owned = sim.clipboard = text;
        clearTimeout(timer);
        timer = setTimeout(() => { if (sim.clipboard === owned) sim.clipboard = null; }, ttlMs);
        return true;
      },
      clearClipboardIfOwned: async () => { if (sim.clipboard === owned) sim.clipboard = null; },
      openExternal: async url => { sim.opened.push(url); return true; }
    },
    {
      saveExportFile: async (filename, data, how) => {
        if (how === 'share') { sim.shared.push(filename); return true; }
        const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        return true;
      },
      // Equivalente del selector nativo: <input type=file> temporal (Playwright usa setInputFiles).
      pickImportFile: () =>
        new Promise(resolve => {
          const input = document.createElement('input');
          input.type = 'file';
          input.id = 'kp-sim-file';
          input.style.display = 'none';
          input.addEventListener('change', async () => {
            const file = input.files?.[0];
            input.remove();
            resolve(file ? { name: file.name, text: await file.text() } : null);
          });
          input.addEventListener('cancel', () => { input.remove(); resolve(null); });
          document.body.appendChild(input);
          input.click();
        })
    }
  );
}
