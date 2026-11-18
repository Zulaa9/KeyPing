import { TestBed } from '@angular/core/testing';
import { SettingsComponent } from './settings';
import { installFakeKeyping, uninstallFakeKeyping, testProviders } from '../../../testing/fake-keyping';

describe('SettingsComponent – importación', () => {
  let api: Record<string, jasmine.Spy>;
  let component: SettingsComponent;

  beforeEach(async () => {
    const fileEntries = Array.from({ length: 60 }, (_, i) => ({ id: `n${i}`, label: `Entrada ${i}` }));
    // Versión antigua de la primera entrada (historial): no debe listarse como entrada suelta.
    fileEntries.push({ id: 'old0', label: 'Entrada 0', active: false } as any);
    api = installFakeKeyping([], {
      parseImport: jasmine.createSpy('parseImport').and.resolveTo({ entries: fileEntries, source: 'plain' }),
      importVault: jasmine.createSpy('importVault').and.resolveTo({ imported: 60, overwritten: false })
    });
    await TestBed.configureTestingModule({ imports: [SettingsComponent], providers: testProviders }).compileComponents();
    component = TestBed.createComponent(SettingsComponent).componentInstance;
  });
  afterEach(() => uninstallFakeKeyping());

  it('fusiona todas las entradas del archivo, no solo las 50 primeras, y sin enviar secretos', async () => {
    component.importMode = 'merge';
    const file = new File(['{"entries":[]}'], 'backup.json', { type: 'application/json' });
    const input = { files: [file], value: 'x' } as unknown as HTMLInputElement;
    await component.onImportFile({ target: input } as unknown as Event);
    expect(component.mergePreview.length).toBe(60);

    component.applyImport();
    await new Promise(r => setTimeout(r));
    const [mode, selection] = api['importVault'].calls.mostRecent().args;
    expect(mode).toBe('merge');
    expect(selection.length).toBe(60);
    expect(Object.keys(selection[0]).sort()).toEqual(['idx', 'label']);
  });
});
