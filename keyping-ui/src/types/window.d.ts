// global window typings for preload api
export {};

declare global {
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
      ping?(): Promise<string>;
    };
  }
}
