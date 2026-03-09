// global window typings for preload api
export {};

declare global {
  type UpdateStatus =
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'downloaded'
    | 'upToDate'
    | 'error';

  type UpdateState = {
    status: UpdateStatus;
    currentVersion: string;
    availableVersion?: string;
    progressPercent?: number;
    transferredBytes?: number;
    totalBytes?: number;
    errorMessage?: string;
    checkedAt?: number;
  };

  type UpdatePreferences = {
    autoCheck: boolean;
    autoDownload: boolean;
    installOnQuit: boolean;
  };

  interface Window {
    keyping?: {
      checkCandidate(pwd: string): Promise<{ level: 'ok' | 'warn' | 'danger'; reasons: string[] }>;
      savePassword(
        pwd: string,
        label?: string,
        loginUrl?: string,
        passwordChangeUrl?: string,
        username?: string,
        email?: string,
        folder?: string,
        twoFactorEnabled?: boolean,
        iconName?: string,
        iconSource?: 'auto' | 'manual',
        detectedService?: string
      ): Promise<{
        id: string; createdAt: number; length: number; classMask: number;
        label?: string; loginUrl?: string; passwordChangeUrl?: string; username?: string; email?: string; folder?: string;
        iconName?: string; iconSource?: 'auto' | 'manual'; detectedService?: string;
      }>;
      listPasswords(): Promise<Array<{
        id: string; createdAt: number; length: number; classMask: number;
        label?: string; loginUrl?: string; passwordChangeUrl?: string; username?: string; email?: string; folder?: string;
        iconName?: string; iconSource?: 'auto' | 'manual'; detectedService?: string;
      }>>;
      updateMeta?(
        id: string,
        label?: string,
        loginUrl?: string,
        passwordChangeUrl?: string,
        username?: string,
        email?: string,
        folder?: string,
        twoFactorEnabled?: boolean,
        iconName?: string,
        iconSource?: 'auto' | 'manual',
        detectedService?: string
      ): Promise<{
        id: string; createdAt: number; length: number; classMask: number;
        label?: string; loginUrl?: string; passwordChangeUrl?: string; username?: string; email?: string; folder?: string;
        iconName?: string; iconSource?: 'auto' | 'manual'; detectedService?: string;
      }>;
      getUpdateState?(): Promise<UpdateState>;
      getUpdatePreferences?(): Promise<UpdatePreferences>;
      setUpdatePreferences?(preferences: Partial<UpdatePreferences>): Promise<UpdatePreferences>;
      checkForUpdates?(): Promise<UpdateState>;
      downloadUpdate?(): Promise<UpdateState>;
      installUpdateAndRestart?(): Promise<boolean>;
      postponeUpdate?(): Promise<UpdateState>;
      onUpdateState?(listener: (payload: UpdateState) => void): (() => void) | void;
      ping?(): Promise<string>;
    };
  }
}
