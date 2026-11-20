// Puente común de las builds móviles: instancia el núcleo compartido (core/keyping-service.ts,
// el mismo que usa el escritorio) con los servicios nativos de cada plataforma.
import { KeypingService, NativeServices, TextStore } from '../../../../core/keyping-service';
import { webCrypto } from '../../../../core/web-crypto';

export type ExportDelivery = 'save' | 'share';

export type MobileExtras = {
  /** Guarda (selector de archivos del sistema) o comparte (hoja de compartir) un archivo de exportación. */
  saveExportFile(filename: string, text: string, how: ExportDelivery): Promise<boolean>;
  /** Abre el selector del sistema y devuelve el texto del archivo elegido (null si se cancela). */
  pickImportFile(): Promise<{ name: string; text: string } | { error: 'too-large' | 'read-error' } | null>;
};

// Mientras está abierto un selector o la hoja de compartir que ha abierto la propia app, la actividad
// pasa a segundo plano: no se bloquea, salvo que la ausencia supere este margen.
export const SYSTEM_UI_GRACE_MS = 3 * 60_000;

export type MobilePlatform = {
  name: string;
  service: KeypingService;
  extras: MobileExtras;
  /** Ejecuta una acción que abre interfaz del sistema (selector, compartir) sin bloquear la bóveda. */
  withSystemUi<T>(fn: () => Promise<T>): Promise<T>;
};

let current: MobilePlatform | null = null;
let pausedHandler: () => void = () => {};

/** Aviso nativo de pausa de la actividad (respeta el selector abierto igual que visibilitychange). */
export function notifyPaused(): void {
  pausedHandler();
}

export function platform(): MobilePlatform {
  if (!current) throw new Error('platform-not-installed');
  return current;
}

export function installMobileBridge(name: string, store: TextStore, native: NativeServices, extras: MobileExtras): KeypingService {
  const service = new KeypingService(name, store, webCrypto, native);
  // Ventana en la que se espera que la app pase a segundo plano por una interfaz del sistema que ella
  // misma ha abierto. Se consume al volver a primer plano.
  let allowUntil = 0;
  let hiddenAt: number | null = null;
  const onHidden = (): void => {
    if (Date.now() < allowUntil) {
      hiddenAt ??= Date.now();
      return;
    }
    service.lockNow(true);
  };
  const onVisible = (): void => {
    if (hiddenAt !== null) {
      allowUntil = 0;
      if (Date.now() - hiddenAt > SYSTEM_UI_GRACE_MS) service.lockNow(true);
    }
    hiddenAt = null;
  };
  const withSystemUi = async <T>(fn: () => Promise<T>): Promise<T> => {
    allowUntil = Date.now() + SYSTEM_UI_GRACE_MS;
    try {
      return await fn();
    } finally {
      // La hoja de compartir responde antes de abrirse: se deja un margen breve para que llegue la
      // pausa; si la app no ha pasado a segundo plano, la ventana se cierra.
      setTimeout(() => { if (hiddenAt === null) allowUntil = 0; }, 1500);
    }
  };
  current = { name, service, extras, withSystemUi };
  // Bloqueo al pasar a segundo plano (cambio de app, pantalla apagada, vista de recientes).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onHidden();
    else onVisible();
  });
  pausedHandler = onHidden;
  return service;
}
