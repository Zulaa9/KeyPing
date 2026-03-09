import { AppUpdateService } from './app-update.service';
import { ElectronService } from './electron.service';
import { UpdatePreferences, UpdateState } from './update.types';

class FakeElectronService {
  constructor(private electron = true) {}

  isElectron(): boolean {
    return this.electron;
  }
}

describe('AppUpdateService', () => {
  const baseState: UpdateState = {
    status: 'idle',
    currentVersion: '1.0.0'
  };

  const basePreferences: UpdatePreferences = {
    autoCheck: true,
    autoDownload: true,
    installOnQuit: true
  };

  const createApi = () => {
    let stateListener: ((payload: UpdateState) => void) | undefined;

    return {
      api: {
        getUpdateState: jasmine.createSpy('getUpdateState').and.resolveTo(baseState),
        getUpdatePreferences: jasmine.createSpy('getUpdatePreferences').and.resolveTo(basePreferences),
        setUpdatePreferences: jasmine.createSpy('setUpdatePreferences').and.callFake(async (input: Partial<UpdatePreferences>) => ({
          ...basePreferences,
          ...input
        })),
        checkForUpdates: jasmine.createSpy('checkForUpdates').and.resolveTo({
          status: 'upToDate',
          currentVersion: '1.0.0'
        } as UpdateState),
        downloadUpdate: jasmine.createSpy('downloadUpdate').and.resolveTo({
          status: 'downloading',
          currentVersion: '1.0.0',
          availableVersion: '1.1.0',
          progressPercent: 12,
          transferredBytes: 120,
          totalBytes: 1000
        } as UpdateState),
        installUpdateAndRestart: jasmine.createSpy('installUpdateAndRestart').and.resolveTo(true),
        postponeUpdate: jasmine.createSpy('postponeUpdate').and.resolveTo({
          status: 'idle',
          currentVersion: '1.0.0'
        } as UpdateState),
        onUpdateState: jasmine.createSpy('onUpdateState').and.callFake((listener: (payload: UpdateState) => void) => {
          stateListener = listener;
          return () => {
            stateListener = undefined;
          };
        })
      },
      emitState(payload: UpdateState) {
        stateListener?.(payload);
      }
    };
  };

  afterEach(() => {
    delete (window as any).keyping;
  });

  it('loads initial state and preferences and subscribes to updates', async () => {
    const bridge = createApi();
    (window as any).keyping = bridge.api;

    const service = new AppUpdateService(new FakeElectronService(true) as unknown as ElectronService);
    await service.initialize();

    expect(bridge.api.getUpdateState).toHaveBeenCalled();
    expect(bridge.api.getUpdatePreferences).toHaveBeenCalled();
    expect(service.snapshot.status).toBe('idle');
    expect(service.preferencesSnapshot.autoDownload).toBeTrue();

    bridge.emitState({ status: 'available', currentVersion: '1.0.0', availableVersion: '1.1.0' });
    expect(service.snapshot.status).toBe('available');
    expect(service.snapshot.availableVersion).toBe('1.1.0');
  });

  it('marks up-to-date as user visible after manual check', async () => {
    const bridge = createApi();
    (window as any).keyping = bridge.api;

    const service = new AppUpdateService(new FakeElectronService(true) as unknown as ElectronService);
    await service.initialize();

    expect(service.shouldShowUpToDate).toBeFalse();
    await service.checkForUpdates(true);
    expect(service.snapshot.status).toBe('upToDate');
    expect(service.shouldShowUpToDate).toBeTrue();
  });

  it('handles download/install/postpone actions', async () => {
    const bridge = createApi();
    (window as any).keyping = bridge.api;

    const service = new AppUpdateService(new FakeElectronService(true) as unknown as ElectronService);
    await service.initialize();

    await service.downloadUpdate();
    expect(bridge.api.downloadUpdate).toHaveBeenCalled();
    expect(service.snapshot.status).toBe('downloading');

    bridge.emitState({ status: 'downloaded', currentVersion: '1.0.0', availableVersion: '1.1.0' });
    expect(service.snapshot.status).toBe('downloaded');

    const install = await service.installUpdateAndRestart();
    expect(install).toBeTrue();

    await service.postponeUpdate();
    expect(bridge.api.postponeUpdate).toHaveBeenCalled();
    expect(service.snapshot.status).toBe('idle');
  });

  it('does not crash when electron bridge is unavailable', async () => {
    const service = new AppUpdateService(new FakeElectronService(false) as unknown as ElectronService);

    await service.initialize();
    const checked = await service.checkForUpdates();

    expect(checked.status).toBe('idle');
    expect(service.snapshot.currentVersion).toBe('0.0.0');
  });
});
