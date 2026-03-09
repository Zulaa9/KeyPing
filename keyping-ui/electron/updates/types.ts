// Tipos compartidos del módulo de actualizaciones (proceso principal/preload).
export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'upToDate'
  | 'error';

export type UpdateState = {
  // Estado serializable que se envía por IPC a la UI.
  status: UpdateStatus;
  currentVersion: string;
  availableVersion?: string;
  progressPercent?: number;
  transferredBytes?: number;
  totalBytes?: number;
  errorMessage?: string;
  checkedAt?: number;
};

export type UpdatePreferences = {
  // Preferencias de comportamiento del updater persistidas en disco.
  autoCheck: boolean;
  autoDownload: boolean;
  installOnQuit: boolean;
};

export type UpdateStateEventPayload = UpdateState;
