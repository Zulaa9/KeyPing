export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'upToDate'
  | 'error';

export type UpdateState = {
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
  autoCheck: boolean;
  autoDownload: boolean;
  installOnQuit: boolean;
};
