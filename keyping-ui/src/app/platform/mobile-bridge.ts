// Puente común de las builds móviles: crea window.keyping con el núcleo compartido
// (core/keyping-service.ts) y añade lo que solo existe en el móvil.
import { KeypingService, NativeServices, TextStore } from '../../../core/keyping-service';
import { webCrypto } from '../../../core/web-crypto';
import pkg from '../../../package.json';

export type ExportDelivery = 'save' | 'share';

export type MobileExtras = {
  /** Guarda (selector de archivos del sistema) o comparte (hoja de compartir) un archivo de exportación. */
  saveExportFile(filename: string, text: string, how: ExportDelivery): Promise<boolean>;
};

export function installMobileBridge(platform: string, store: TextStore, native: NativeServices, extras: MobileExtras): KeypingService {
  const service = new KeypingService(platform, store, webCrypto, native);
  const updateState = { status: 'idle', currentVersion: pkg.version, storeManaged: true };
  const prefs = { autoCheck: false, autoDownload: false, installOnQuit: false };
  const bridge = {
    ...service.asBridge(),
    mobile: true,
    // Las actualizaciones llegan por la tienda: mismo estado que la versión de Microsoft Store.
    getUpdateState: async () => updateState,
    getUpdatePreferences: async () => prefs,
    setUpdatePreferences: async () => prefs,
    checkForUpdates: async () => updateState,
    downloadUpdate: async () => updateState,
    installUpdateAndRestart: async () => false,
    postponeUpdate: async () => updateState,
    onUpdateState: () => () => {},
    saveExportFile: extras.saveExportFile
  };
  document.documentElement.classList.add('kp-mobile');
  Object.defineProperty(window, 'keyping', { value: Object.freeze(bridge), configurable: false, writable: false });

  // Bloqueo al pasar a segundo plano (cambio de app, pantalla apagada, vista de recientes).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') service.lockNow(true);
  });
  return service;
}
