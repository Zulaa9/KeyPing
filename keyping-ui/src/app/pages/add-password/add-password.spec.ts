import { installFakeKeyping, uninstallFakeKeyping, testProviders } from '../../../testing/fake-keyping';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AddPasswordComponent } from './add-password';

describe('AddPasswordComponent', () => {
  beforeEach(() => installFakeKeyping());
  afterEach(() => uninstallFakeKeyping());

  let component: AddPasswordComponent;
  let fixture: ComponentFixture<AddPasswordComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AddPasswordComponent],
      providers: testProviders
    })
    .compileComponents();

    fixture = TestBed.createComponent(AddPasswordComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

describe('AddPasswordComponent – validación', () => {
  let api: Record<string, jasmine.Spy>;
  let component: AddPasswordComponent;

  beforeEach(async () => {
    api = installFakeKeyping();
    await TestBed.configureTestingModule({ imports: [AddPasswordComponent], providers: testProviders }).compileComponents();
    component = TestBed.createComponent(AddPasswordComponent).componentInstance;
  });
  afterEach(() => uninstallFakeKeyping());

  it('no guarda si un enlace usa un esquema peligroso', async () => {
    component.pwd = 'Secret-123456';
    component.passwordChangeUrl = 'javascript:alert(1)';
    await component.onSave();
    expect(component.changeUrlError).toBeTrue();
    expect(api['savePassword']).not.toHaveBeenCalled();
  });

  it('evita guardados dobles si se pulsa dos veces', async () => {
    component.pwd = 'Secret-123456';
    component.passwordChangeUrl = 'github.com/settings/security';
    await Promise.all([component.onSave(), component.onSave()]);
    expect(api['savePassword']).toHaveBeenCalledTimes(1);
  });

  it('muestra un error si el guardado falla', async () => {
    api['savePassword'].and.rejectWith(new Error('boom'));
    component.pwd = 'Secret-123456';
    await component.onSave();
    expect(component.saveError).toBeTruthy();
  });

  it('el botón Generar crea una contraseña segura y la muestra', () => {
    component.onGenerate();
    expect(component.pwd.length).toBe(20);
    expect(component.showPwd).toBeTrue();
  });
});
