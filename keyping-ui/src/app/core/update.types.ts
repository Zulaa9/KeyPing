// Tipos compartidos del flujo de actualizaciones (renderer).
export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'upToDate'
  | 'error';

export type UpdateState = {
  // Estado actual del ciclo de actualización y metadatos asociados.
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
  // Preferencias persistidas para checks/descarga/instalación.
  autoCheck: boolean;
  autoDownload: boolean;
  installOnQuit: boolean;
};
