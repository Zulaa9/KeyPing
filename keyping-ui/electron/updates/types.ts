// Tipos compartidos del módulo de actualizaciones (proceso principal/preload).
export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'upToDate'
  | 'error';

export type UpdateErrorCode = 'network' | 'server' | 'permissions' | 'signature' | 'generic';

export type UpdateState = {
  // Estado serializable que se envía por IPC a la UI.
  status: UpdateStatus;
  currentVersion: string;
  availableVersion?: string;
  progressPercent?: number;
  transferredBytes?: number;
  totalBytes?: number;
  errorMessage?: string;
  // Categoría estable del error para traducirla en el renderer (es/en).
  errorCode?: UpdateErrorCode;
  checkedAt?: number;
  // true en la versión de Microsoft Store: la Store actualiza la app y KeyPing no comprueba nada.
  storeManaged?: boolean;
};

export type UpdatePreferences = {
  // Preferencias de comportamiento del updater persistidas en disco.
  autoCheck: boolean;
  autoDownload: boolean;
  installOnQuit: boolean;
};

export type UpdateStateEventPayload = UpdateState;
