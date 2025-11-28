import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgIf, NgFor, NgClass } from '@angular/common';
import { ElectronService, VaultImportEntry } from '../../core/electron.service';
import { MasterLockService } from '../../core/master-lock.service';
import { PasswordCountService } from '../../core/password-count.service';

type MergeReason = 'new' | 'conflict' | 'existing';

type MergePreviewItem = {
  label: string;
  username?: string;
  email?: string;
  selected: boolean;
  reason: MergeReason;
};

type StatusMsg = { type: 'success' | 'error' | 'info'; text: string };

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule, NgIf, NgFor, NgClass],
  templateUrl: './settings.html',
  styleUrls: ['./settings.scss']
})
export class SettingsComponent implements OnInit {
  masterForm = { current: '', next: '', confirm: '' };
  masterMessage?: StatusMsg;

  autoLockMinutes = 5;
  autoLockMessage?: string;

  freeAttempts = 3;
  baseDelaySeconds = 5;
  growthFactor = 2;
  attemptMessage?: string;

  language = 'es';
  languageMessage?: string;

  exportMessage?: string;
  exporting = false;

  importMode: 'overwrite' | 'merge' = 'merge';
  importMessage?: string;
  importState?: 'success' | 'error' | 'info';
  importFilename = '';
  mergePreview: MergePreviewItem[] = [];
  importEntries: VaultImportEntry[] = [];
  importEncrypted?: string;
  importSource: 'encrypted' | 'plain' | null = null;
  importing = false;

  constructor(
    private es: ElectronService,
    private master: MasterLockService,
    private passwordCountSvc: PasswordCountService
  ) {}

  ngOnInit(): void {
    this.autoLockMinutes = this.master.getAutoLockMinutes();
    const policy = this.master.getAttemptPolicy();
    this.freeAttempts = policy.freeAttempts;
    this.baseDelaySeconds = Math.round(policy.baseDelayMs / 1000);
    this.growthFactor = policy.growthFactor;
  }

  async onUpdateMaster(): Promise<void> {
    this.masterMessage = undefined;
    const { current, next, confirm } = this.masterForm;
    if (!current || !next || !confirm) {
      this.masterMessage = { type: 'error', text: 'Rellena los tres campos.' };
      return;
    }
    if (next.length < 8) {
      this.masterMessage = { type: 'error', text: 'La nueva contrase\u00f1a debe tener m\u00ednimo 8 caracteres.' };
      return;
    }
    if (next !== confirm) {
      this.masterMessage = { type: 'error', text: 'La confirmaci\u00f3n no coincide.' };
      return;
    }

    const ok = await this.master.rotateMaster(current, next);
    if (!ok) {
      this.masterMessage = { type: 'error', text: 'La contrase\u00f1a actual no es correcta o hay un bloqueo temporal.' };
      return;
    }

    this.masterMessage = { type: 'success', text: 'Contrase\u00f1a maestra actualizada. Se ha bloqueado para reingresar con la nueva clave.' };
    this.masterForm = { current: '', next: '', confirm: '' };
  }

  resetMasterForm(): void {
    this.masterForm = { current: '', next: '', confirm: '' };
    this.masterMessage = undefined;
  }

  onSaveAutoLock(): void {
    this.master.setAutoLockMinutes(this.autoLockMinutes);
    this.autoLockMinutes = this.master.getAutoLockMinutes();
    this.autoLockMessage = `Autobloqueo ajustado a ${this.autoLockMinutes} minutos de inactividad.`;
  }

  onSaveAttempts(): void {
    this.master.setAttemptPolicy(
      this.freeAttempts,
      this.baseDelaySeconds * 1000,
      this.growthFactor
    );
    this.attemptMessage = `Intentos libres: ${this.freeAttempts}. Despu\u00e9s, delay inicial ${this.baseDelaySeconds}s creciendo x${this.growthFactor}.`;
  }

  get delayPreview(): number[] {
    const values: number[] = [];
    const total = Math.max(6, this.freeAttempts + 5);
    for (let i = 0; i < total; i++) {
      const attemptNumber = i + 1;
      if (attemptNumber <= this.freeAttempts) {
        values.push(0);
      } else {
        const exp = attemptNumber - this.freeAttempts - 1;
        const delay = this.baseDelaySeconds * Math.pow(this.growthFactor, Math.max(0, exp));
        values.push(Math.round(delay * 10) / 10);
      }
    }
    return values;
  }

  reasonLabel(reason: MergeReason): string {
    if (reason === 'new') return 'Nuevo';
    if (reason === 'conflict') return 'Conflicto';
    return 'Existente';
  }

  onLanguageChange(): void {
    const label = this.language === 'en' ? 'English' : this.language === 'fr' ? 'Fran\u00e7ais' : 'Espa\u00f1ol';
    this.languageMessage = `Idioma preferido: ${label}.`;
  }

  async onExportVault(): Promise<void> {
    this.exportMessage = undefined;
    this.exporting = true;
    try {
      const res = await this.es.exportVault();
      const blob = this.base64ToBlob(res.base64, 'application/octet-stream');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename || 'keyping-vault.keyping';
      a.click();
      URL.revokeObjectURL(url);
      this.exportMessage = 'Vault exportado de forma cifrada y descargado.';
    } catch (err) {
      console.error('[settings] export error', err);
      this.exportMessage = 'No se pudo exportar el vault.';
    } finally {
      this.exporting = false;
    }
  }

  onModeChange(): void {
    this.importMessage = undefined;
    this.importState = undefined;
    if (this.importMode === 'overwrite') {
      this.mergePreview = [];
    }
  }

  async onImportFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.importFilename = file.name;
    this.importMessage = undefined;
    this.importState = undefined;

    try {
      const text = await file.text();
      const parsed = await this.es.parseImport(text);
      const rawFile = this.safeParse(text);

      this.importEntries = parsed.entries || [];
      this.importSource = parsed.source;
      this.importEncrypted =
        rawFile?.format === 'keyping-export-v1' && typeof rawFile?.vault === 'string'
          ? rawFile.vault
          : undefined;

      this.mergePreview = this.importEntries.slice(0, 50).map((raw, idx) => ({
        label: raw?.label || (raw as any)?.name || (raw as any)?.title || `Entrada ${idx + 1}`,
        username: raw?.username || (raw as any)?.user,
        email: raw?.email,
        selected: true,
        reason: raw?.id ? 'existing' : (raw as any)?.conflict ? 'conflict' : 'new'
      }));

      if (this.importMode === 'overwrite') {
        this.importMessage = 'Archivo listo. Se sobrescribir\u00e1 el vault actual.';
        this.importState = 'success';
      } else {
        const count = this.mergePreview.length;
        this.importMessage = count
          ? `Vista previa lista: ${count} contrase\u00f1as para fusionar.`
          : 'No se encontraron contrase\u00f1as en el archivo.';
        this.importState = count ? 'success' : 'info';
      }
    } catch (err) {
      console.error('[settings] import parse error', err);
      this.importMessage = 'No se pudo leer el archivo. Aseg\u00farate de que sea JSON v\u00e1lido.';
      this.mergePreview = [];
      this.importEntries = [];
      this.importEncrypted = undefined;
      this.importSource = null;
      this.importState = 'error';
    } finally {
      input.value = '';
    }
  }

  applyImport(): void {
    if (this.importMode === 'overwrite') {
      this.runImport('overwrite');
      return;
    }

    if (!this.mergePreview.length) {
      this.importMessage = 'Carga un archivo para elegir qu\u00e9 fusionar.';
      this.importState = 'info';
      return;
    }

    const selected = this.mergePreview.filter(item => item.selected).length;
    this.importMessage = selected
      ? `Fusionar\u00e1s ${selected} contrase\u00f1as del archivo importado.`
      : 'Has descartado todas las nuevas contrase\u00f1as.';
    this.importState = selected ? 'success' : 'info';

    if (selected > 0) {
      this.runImport('merge');
    }
  }

  selectAllMerge(selected: boolean): void {
    this.mergePreview = this.mergePreview.map(item => ({ ...item, selected }));
  }

  private base64ToBlob(b64: string, type: string): Blob {
    const bin = atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return new Blob([bytes], { type });
  }

  private async runImport(mode: 'overwrite' | 'merge'): Promise<void> {
    if (this.importing) return;
    this.importing = true;
    try {
      if (mode === 'overwrite' && !this.importFilename) {
        this.importMessage = 'Selecciona un archivo para sobrescribir el vault.';
        this.importState = 'info';
        return;
      }

      const selectedEntries =
        mode === 'merge'
          ? this.mergePreview
              .map((item, idx) => (item.selected ? this.importEntries[idx] : null))
              .filter((e): e is VaultImportEntry => !!e)
          : this.importEntries;

      const res = await this.es.importVault(mode, selectedEntries, this.importEncrypted);
      this.importState = 'success';
      this.importMessage =
        mode === 'overwrite'
          ? `Vault sobrescrito (${res.imported} entradas).`
          : `Fusionadas ${res.imported} contrase\u00f1as nuevas.`;
      await this.passwordCountSvc.refreshFromDisk();
    } catch (err) {
      console.error('[settings] import error', err);
      this.importState = 'error';
      this.importMessage = 'No se pudo importar el archivo.';
    } finally {
      this.importing = false;
    }
  }

  private safeParse(text: string): any {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
}
