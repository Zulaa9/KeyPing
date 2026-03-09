import { app, BrowserWindow, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { UpdatePreferences, UpdateState } from './types';

const UPDATE_EVENT_CHANNEL = 'keyping:update:state';
const SETTINGS_FILE = 'update-settings.json';
const STARTUP_CHECK_DELAY_MS = 5_000;
const MIN_CHECK_INTERVAL_MS = 60_000;

const DEFAULT_PREFERENCES: UpdatePreferences = {
  autoCheck: true,
  autoDownload: false,
  installOnQuit: true
};

type SetPreferencesInput = Partial<UpdatePreferences>;

export class AutoUpdateService {
  private readonly settingsPath = path.join(app.getPath('userData'), SETTINGS_FILE);
  private readonly getWindows: () => BrowserWindow[];

  private preferences: UpdatePreferences = { ...DEFAULT_PREFERENCES };
  private state: UpdateState = {
    status: 'idle',
    currentVersion: app.getVersion()
  };

  private isInitialized = false;
  private isChecking = false;
  private lastCheckAt = 0;

  constructor(getWindows: () => BrowserWindow[]) {
    this.getWindows = getWindows;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;

    this.preferences = await this.loadPreferences();
    this.configureUpdater();
    this.bindUpdaterEvents();
    this.registerIpcHandlers();

    if (this.preferences.autoCheck) {
      setTimeout(() => {
        void this.checkForUpdates('startup');
      }, STARTUP_CHECK_DELAY_MS);
    }
  }

  attachWindow(window: BrowserWindow): void {
    window.webContents.once('did-finish-load', () => {
      this.sendState(window);
    });
  }

  getState(): UpdateState {
    return { ...this.state };
  }

  getPreferences(): UpdatePreferences {
    return { ...this.preferences };
  }

  async setPreferences(input: SetPreferencesInput): Promise<UpdatePreferences> {
    this.preferences = {
      ...this.preferences,
      ...this.sanitizePreferences(input)
    };

    this.configureUpdater();
    await this.persistPreferences();
    return this.getPreferences();
  }

  async checkForUpdates(trigger: 'startup' | 'manual' = 'manual'): Promise<UpdateState> {
    if (!this.canUseUpdater()) {
      return this.getState();
    }

    const now = Date.now();
    if (this.isChecking) {
      return this.getState();
    }

    if (trigger === 'startup' && now - this.lastCheckAt < MIN_CHECK_INTERVAL_MS) {
      return this.getState();
    }

    this.isChecking = true;
    this.updateState({
      status: 'checking',
      errorMessage: undefined,
      checkedAt: now,
      progressPercent: undefined,
      transferredBytes: undefined,
      totalBytes: undefined
    });

    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      this.updateState({
        status: 'error',
        errorMessage: this.formatError(error),
        checkedAt: Date.now()
      });
    } finally {
      this.lastCheckAt = Date.now();
      this.isChecking = false;
    }

    return this.getState();
  }

  async downloadUpdate(): Promise<UpdateState> {
    if (!this.canUseUpdater()) {
      return this.getState();
    }

    if (this.state.status !== 'available' && this.state.status !== 'error') {
      return this.getState();
    }

    this.updateState({
      status: 'downloading',
      errorMessage: undefined,
      progressPercent: 0,
      transferredBytes: 0
    });

    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      this.updateState({
        status: 'error',
        errorMessage: this.formatError(error)
      });
    }

    return this.getState();
  }

  installUpdateAndRestart(): boolean {
    if (!this.canUseUpdater() || this.state.status !== 'downloaded') {
      return false;
    }

    setImmediate(() => {
      autoUpdater.quitAndInstall(false, true);
    });

    return true;
  }

  postponeUpdate(): UpdateState {
    if (this.state.status === 'downloaded') {
      return this.getState();
    }

    this.updateState({
      status: 'idle',
      errorMessage: undefined,
      progressPercent: undefined,
      transferredBytes: undefined,
      totalBytes: undefined
    });

    return this.getState();
  }

  private canUseUpdater(): boolean {
    return app.isPackaged;
  }

  private configureUpdater(): void {
    // We always ask the user first before downloading.
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = this.preferences.installOnQuit;
    autoUpdater.allowDowngrade = false;
  }

  private bindUpdaterEvents(): void {
    autoUpdater.on('checking-for-update', () => {
      this.updateState({
        status: 'checking',
        errorMessage: undefined,
        checkedAt: Date.now()
      });
    });

    autoUpdater.on('update-available', info => {
      this.updateState({
        status: 'available',
        availableVersion: info.version,
        errorMessage: undefined,
        progressPercent: undefined,
        transferredBytes: undefined,
        totalBytes: undefined,
        checkedAt: Date.now()
      });
    });

    autoUpdater.on('download-progress', progress => {
      this.updateState({
        status: 'downloading',
        progressPercent: Number(progress.percent.toFixed(2)),
        transferredBytes: progress.transferred,
        totalBytes: progress.total,
        errorMessage: undefined
      });
    });

    autoUpdater.on('update-downloaded', info => {
      this.updateState({
        status: 'downloaded',
        availableVersion: info.version,
        progressPercent: 100,
        transferredBytes: undefined,
        totalBytes: undefined,
        errorMessage: undefined,
        checkedAt: Date.now()
      });
    });

    autoUpdater.on('update-not-available', () => {
      this.updateState({
        status: 'upToDate',
        availableVersion: undefined,
        progressPercent: undefined,
        transferredBytes: undefined,
        totalBytes: undefined,
        errorMessage: undefined,
        checkedAt: Date.now()
      });
    });

    autoUpdater.on('error', error => {
      this.updateState({
        status: 'error',
        errorMessage: this.formatError(error),
        checkedAt: Date.now()
      });
    });
  }

  private registerIpcHandlers(): void {
    ipcMain.handle('keyping:update:getState', async () => this.getState());
    ipcMain.handle('keyping:update:getPreferences', async () => this.getPreferences());
    ipcMain.handle('keyping:update:setPreferences', async (_event, input: SetPreferencesInput) => {
      return this.setPreferences(input ?? {});
    });
    ipcMain.handle('keyping:update:check', async () => this.checkForUpdates('manual'));
    ipcMain.handle('keyping:update:download', async () => this.downloadUpdate());
    ipcMain.handle('keyping:update:install', async () => this.installUpdateAndRestart());
    ipcMain.handle('keyping:update:postpone', async () => this.postponeUpdate());
  }

  private async loadPreferences(): Promise<UpdatePreferences> {
    try {
      const raw = await fs.readFile(this.settingsPath, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_PREFERENCES,
        ...this.sanitizePreferences(parsed)
      };
    } catch {
      return { ...DEFAULT_PREFERENCES };
    }
  }

  private sanitizePreferences(value: unknown): SetPreferencesInput {
    const input = value as SetPreferencesInput;
    return {
      autoCheck: typeof input?.autoCheck === 'boolean' ? input.autoCheck : undefined,
      autoDownload: typeof input?.autoDownload === 'boolean' ? input.autoDownload : undefined,
      installOnQuit: typeof input?.installOnQuit === 'boolean' ? input.installOnQuit : undefined
    };
  }

  private async persistPreferences(): Promise<void> {
    const payload = JSON.stringify(this.preferences, null, 2);
    await fs.writeFile(this.settingsPath, payload, 'utf8');
  }

  private updateState(next: Partial<UpdateState>): void {
    this.state = {
      ...this.state,
      ...next,
      currentVersion: app.getVersion()
    };

    this.broadcastState();
  }

  private broadcastState(): void {
    for (const window of this.getWindows()) {
      this.sendState(window);
    }
  }

  private sendState(window: BrowserWindow): void {
    if (window.isDestroyed()) return;
    window.webContents.send(UPDATE_EVENT_CHANNEL, this.getState());
  }

  private formatError(error: unknown): string {
    const message = error instanceof Error && error.message ? error.message : String(error || '');
    const lower = message.toLowerCase();

    if (lower.includes('net::err_internet_disconnected') || lower.includes('econnrefused') || lower.includes('etimedout') || lower.includes('fetch failed')) {
      return 'No se pudo conectar al servidor de actualizaciones.';
    }

    if (lower.includes('enotfound') || lower.includes('name not resolved')) {
      return 'No se pudo resolver el servidor de actualizaciones.';
    }

    if (lower.includes('403') || lower.includes('401') || lower.includes('forbidden') || lower.includes('unauthorized')) {
      return 'No hay permisos para descargar esta actualizacion.';
    }

    if (lower.includes('404') || lower.includes('cannot find latest')) {
      return 'No hay informacion de actualizacion disponible.';
    }

    if (message && message !== 'undefined') {
      return 'Error al comprobar actualizaciones.';
    }

    return 'Error desconocido al comprobar actualizaciones.';
  }
}
