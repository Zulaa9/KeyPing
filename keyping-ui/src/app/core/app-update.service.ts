import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { UpdatePreferences, UpdateState } from './update.types';
import { ElectronService } from './electron.service';

type KeypingUpdateApi = {
  getUpdateState(): Promise<UpdateState>;
  getUpdatePreferences(): Promise<UpdatePreferences>;
  setUpdatePreferences(input: Partial<UpdatePreferences>): Promise<UpdatePreferences>;
  checkForUpdates(): Promise<UpdateState>;
  downloadUpdate(): Promise<UpdateState>;
  installUpdateAndRestart(): Promise<boolean>;
  postponeUpdate(): Promise<UpdateState>;
  onUpdateState(listener: (payload: UpdateState) => void): (() => void) | void;
};

const DEFAULT_PREFERENCES: UpdatePreferences = {
  autoCheck: true,
  autoDownload: false,
  installOnQuit: true
};

@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  // Estado reactivo de actualizaciones consumido por Settings y el banner.
  private readonly stateSubject = new BehaviorSubject<UpdateState>({
    status: 'idle',
    currentVersion: '0.0.0'
  });
  private readonly preferencesSubject = new BehaviorSubject<UpdatePreferences>({
    ...DEFAULT_PREFERENCES
  });

  readonly state$ = this.stateSubject.asObservable();
  readonly preferences$ = this.preferencesSubject.asObservable();

  private initialized = false;
  private unsubscribeState?: () => void;
  private wasManualCheckRequested = false;

  constructor(private electron: ElectronService) {}

  get snapshot(): UpdateState {
    return this.stateSubject.value;
  }

  get preferencesSnapshot(): UpdatePreferences {
    return this.preferencesSubject.value;
  }

  get shouldShowUpToDate(): boolean {
    return this.wasManualCheckRequested && this.stateSubject.value.status === 'upToDate';
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    if (!this.electron.isElectron()) {
      return;
    }

    const api = this.api();
    if (!api) return;

    try {
      // Carga estado y preferencias en paralelo para minimizar latencia inicial.
      const [state, preferences] = await Promise.all([
        api.getUpdateState(),
        api.getUpdatePreferences()
      ]);
      this.setState(state);
      this.preferencesSubject.next(preferences);
    } catch (err) {
      console.error('[updates] init failed', err);
    }

    const maybeUnsub = api.onUpdateState((state: UpdateState) => {
      // Fuente de verdad: eventos push desde el proceso principal.
      this.setState(state);
    });

    if (typeof maybeUnsub === 'function') {
      this.unsubscribeState = maybeUnsub;
    }
  }

  async setPreferences(input: Partial<UpdatePreferences>): Promise<UpdatePreferences> {
    const api = this.api();
    if (!api) {
      return this.preferencesSnapshot;
    }

    const next = await api.setUpdatePreferences(input);
    this.preferencesSubject.next(next);
    return next;
  }

  async checkForUpdates(manual = true): Promise<UpdateState> {
    const api = this.api();
    if (!api) {
      return this.snapshot;
    }

    if (manual) {
      // Controla si mostramos el mensaje "ya estás al día" tras checks manuales.
      this.wasManualCheckRequested = true;
    }

    const state = await api.checkForUpdates();
    this.setState(state);
    return state;
  }

  async downloadUpdate(): Promise<UpdateState> {
    const api = this.api();
    if (!api) {
      return this.snapshot;
    }

    const state = await api.downloadUpdate();
    this.setState(state);
    return state;
  }

  async installUpdateAndRestart(): Promise<boolean> {
    const api = this.api();
    if (!api) {
      return false;
    }

    return api.installUpdateAndRestart();
  }

  async postponeUpdate(): Promise<UpdateState> {
    const api = this.api();
    if (!api) {
      return this.snapshot;
    }

    const state = await api.postponeUpdate();
    this.setState(state);
    return state;
  }

  destroy(): void {
    this.unsubscribeState?.();
    this.unsubscribeState = undefined;
  }

  private setState(state: UpdateState): void {
    this.stateSubject.next(state);
  }

  private api(): KeypingUpdateApi | undefined {
    return (window as any).keyping as KeypingUpdateApi | undefined;
  }
}
