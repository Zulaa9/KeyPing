import { installFakeKeyping, uninstallFakeKeyping, testProviders, fakeEntry } from '../../../testing/fake-keyping';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PasswordsComponent } from './passwords';

describe('PasswordsComponent', () => {
  beforeEach(() => installFakeKeyping());
  afterEach(() => uninstallFakeKeyping());

  let component: PasswordsComponent;
  let fixture: ComponentFixture<PasswordsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PasswordsComponent],
      providers: testProviders
    })
    .compileComponents();

    fixture = TestBed.createComponent(PasswordsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

describe('PasswordsComponent – flujo de emergencia', () => {
  let api: Record<string, jasmine.Spy>;
  let component: PasswordsComponent;

  beforeEach(async () => {
    api = installFakeKeyping([
      fakeEntry({ id: 'gh', label: 'Código', loginUrl: 'https://github.com/login', passwordChangeUrl: 'https://github.com/settings/security', username: 'ana-dev' }),
      fakeEntry({ id: 'bank', label: 'Banco', loginUrl: 'https://www.mibanco.es/acceso', email: 'ana@example.com' }),
      fakeEntry({ id: 'mail', label: 'Correo personal', loginUrl: 'https://accounts.google.com/signin', passwordChangeUrl: 'https://myaccount.google.com/signinoptions/password' })
    ]);
    await TestBed.configureTestingModule({ imports: [PasswordsComponent], providers: testProviders }).compileComponents();
    const fixture = TestBed.createComponent(PasswordsComponent);
    component = fixture.componentInstance;
    await component.loadEntries();
  });
  afterEach(() => uninstallFakeKeyping());

  const ids = () => component.filteredEntries.map(e => e.id).sort();

  it('busca por dominio de cualquiera de los dos enlaces', () => {
    component.searchTerm = 'github.com';
    expect(ids()).toEqual(['gh']);
    component.searchTerm = 'mibanco';
    expect(ids()).toEqual(['bank']);
    component.searchTerm = 'myaccount.google';
    expect(ids()).toEqual(['mail']);
  });

  it('ignora tildes y mayúsculas y admite varias palabras', () => {
    component.searchTerm = 'CODIGO';
    expect(ids()).toEqual(['gh']);
    component.searchTerm = 'correo personal';
    expect(ids()).toEqual(['mail']);
  });

  it('encuentra por usuario, email y servicio detectado', () => {
    component.searchTerm = 'ana-dev';
    expect(ids()).toEqual(['gh']);
    component.searchTerm = 'ana@example';
    expect(ids()).toEqual(['bank']);
    component.searchTerm = 'github';
    expect(ids()).toEqual(['gh']);
  });

  it('Enter en el buscador abre el primer resultado', async () => {
    component.searchTerm = 'banco';
    const ev = new KeyboardEvent('keydown', { key: 'Enter' });
    component.onSearchKeydown(ev);
    await Promise.resolve();
    expect(component.selected?.id).toBe('bank');
  });

  it('el acceso directo abre el enlace de cambio sin seleccionar la entrada', async () => {
    const entry = component.entries.find(e => e.id === 'gh')!;
    const ev = new MouseEvent('click');
    await component.openChangeUrl(entry, ev);
    expect(api['openExternal']).toHaveBeenCalledWith('https://github.com/settings/security');
    expect(component.selected?.id).not.toBe('gh');
  });

  it('filtra las entradas sin enlace para cambiar la contraseña', () => {
    component.onlyNoChangeUrl = true;
    expect(ids()).toEqual(['bank']);
  });

  it('genera una contraseña nueva en modo edición y no guarda enlaces peligrosos', async () => {
    await component.onSelect(component.entries.find(e => e.id === 'bank')!);
    component.startDetailEdit();
    component.generateForEdit();
    expect(component.editPwd.length).toBe(20);
    component.editLoginUrl = 'javascript:alert(1)';
    await component.saveDetailEdit();
    expect(component.detailError).toBeTruthy();
    expect(api['updatePassword']).not.toHaveBeenCalled();
    expect(api['updateMeta']).not.toHaveBeenCalled();
  });

  it('muestra un error en vez de la demo si la bóveda no se puede leer', async () => {
    api['listPasswords'].and.rejectWith(new Error('Vault unreadable (decrypt-failed)'));
    await component.loadEntries();
    expect(component.loadError).toBeTrue();
    expect(component.showDemo).toBeFalse();
  });
});
