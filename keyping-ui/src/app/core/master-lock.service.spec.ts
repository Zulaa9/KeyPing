import { TestBed } from '@angular/core/testing';
import { MasterLockService } from './master-lock.service';
import { installFakeKeyping, uninstallFakeKeyping } from '../../testing/fake-keyping';

describe('MasterLockService', () => {
  let service: MasterLockService;
  let api: Record<string, jasmine.Spy>;

  beforeEach(() => {
    localStorage.clear();
    api = installFakeKeyping();
    TestBed.configureTestingModule({});
    service = TestBed.inject(MasterLockService);
  });
  afterEach(() => {
    uninstallFakeKeyping();
    localStorage.clear();
  });

  it('envía el verificador heredado de 1.0.x al desbloquear y lo borra tras el éxito', async () => {
    const legacy = { salt: 'c2FsdA==', check: 'Y2hlY2s=', iterations: 150000 };
    localStorage.setItem('keyping.master.v1', JSON.stringify(legacy));
    expect(await service.unlock('pw-123456')).toBeTrue();
    expect(api['authUnlock']).toHaveBeenCalledWith('pw-123456', legacy);
    expect(localStorage.getItem('keyping.master.v1')).toBeNull();
    expect(service.state$.value).toBe('unlocked');
  });

  it('usa el tiempo de espera que impone el proceso principal', async () => {
    api['authUnlock'].and.resolveTo({ ok: false, reason: 'cooldown', remainingMs: 8000 });
    expect(await service.unlock('wrong')).toBeFalse();
    expect(service.getCooldownSeconds()).toBeGreaterThanOrEqual(7);
    expect(service.lastAuthError?.reason).toBe('cooldown');
  });

  it('informa de una bóveda sin archivo de acceso sin contarlo como intento fallido', async () => {
    api['authUnlock'].and.resolveTo({ ok: false, reason: 'auth-missing', dataDir: '/tmp/x' });
    expect(await service.unlock('whatever')).toBeFalse();
    expect(service.lastAuthError).toEqual({ reason: 'auth-missing', dataDir: '/tmp/x' });
    expect(service.getCooldownSeconds()).toBe(0);
  });

  it('no guarda ningún verificador de la contraseña en localStorage al crear la bóveda', async () => {
    await service.setMaster('new-master-pass');
    expect(api['authSetup']).toHaveBeenCalledWith('new-master-pass');
    expect(localStorage.getItem('keyping.master.v1')).toBeNull();
  });

  it('crea la bóveda importando un .kpenc y queda desbloqueada', async () => {
    const res = await service.setupFromImport('{"format":"keyping-export-v2"}', 'file-master-pass');
    expect(api['authSetupFromImport']).toHaveBeenCalledWith('{"format":"keyping-export-v2"}', 'file-master-pass');
    expect(res).toEqual({ ok: true, imported: 3 });
    expect(service.state$.value).toBe('unlocked');
    expect(localStorage.getItem('keyping.master.v1')).toBeNull();
  });

  it('no desbloquea si la contraseña no es la del archivo', async () => {
    api['authSetupFromImport'].and.resolveTo({ ok: false, reason: 'wrong-password' });
    const res = await service.setupFromImport('{}', 'wrong');
    expect(res).toEqual({ ok: false, reason: 'wrong-password' });
    expect(service.state$.value).not.toBe('unlocked');
  });

  it('trata un error de IPC al importar como fallo sin desbloquear', async () => {
    api['authSetupFromImport'].and.rejectWith(new Error('Unauthorized'));
    expect(await service.setupFromImport('{}', 'pw-123456')).toEqual({ ok: false, reason: 'error' });
    expect(service.state$.value).not.toBe('unlocked');
  });

  it('cambia la contraseña verificándola en el proceso principal y bloquea', async () => {
    await service.setMaster('new-master-pass');
    expect(await service.rotateMaster('new-master-pass', 'another-pass-1')).toBeTrue();
    expect(api['authChange']).toHaveBeenCalledWith('new-master-pass', 'another-pass-1');
    expect(service.state$.value).toBe('locked');
  });

  it('se bloquea cuando el proceso principal avisa (suspensión del equipo)', async () => {
    let listener: () => void = () => {};
    api['onSessionLocked'].and.callFake((fn: () => void) => { listener = fn; return () => {}; });
    await service.init();
    await service.setMaster('new-master-pass');
    listener();
    expect(service.state$.value).toBe('locked');
  });
});
