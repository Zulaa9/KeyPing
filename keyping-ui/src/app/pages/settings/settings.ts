import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgIf, NgFor, NgClass, NgStyle } from '@angular/common';
import { ElectronService, VaultImportEntry } from '../../core/electron.service';
import { MasterLockService } from '../../core/master-lock.service';
import { PasswordCountService } from '../../core/password-count.service';

type MergeReason = 'new' | 'conflict' | 'existing';

type MergePreviewItem = {
  idx: number;
  label: string;
  username?: string;
  email?: string;
  selected: boolean;
  reason: MergeReason;
};

type StatusMsg = { type: 'success' | 'error' | 'info'; text: string };
type TipRow = { label: string; from: string; to: string; tone: 'add' | 'remove' | 'change' | 'same' };

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule, NgIf, NgFor, NgClass, NgStyle],
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
  exportModal = { visible: false, password: '', error: '' };

  importMode: 'overwrite' | 'merge' = 'overwrite';
  importMessage?: string;
  importState?: 'success' | 'error' | 'info';
  importFilename = '';
  mergePreview: MergePreviewItem[] = [];
  importEntries: VaultImportEntry[] = [];
  importEncrypted?: string;
  importSource: 'encrypted' | 'plain' | 'master' | null = null;
  importing = false;
  importPassword = '';
  importPasswordError?: string;
  rawImportText = '';
  mergeFilter = '';
  tooltip = { rows: [] as TipRow[], x: 0, y: 0, visible: false };
  private currentIds = new Set<string>();
  private currentEntries: VaultImportEntry[] = [];
  confirmModal = { visible: false, countdown: 5, mode: 'overwrite' as 'overwrite' | 'merge' };
  private countdownTimer?: any;

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
    this.loadCurrentVaultIds();
  }

  async onUpdateMaster(): Promise<void> {
    this.masterMessage = undefined;
    const { current, next, confirm } = this.masterForm;
    if (!current || !next || !confirm) {
      this.masterMessage = { type: 'error', text: 'Rellena los tres campos.' };
      return;
    }
    if (next.length < 8) {
      this.masterMessage = { type: 'error', text: 'La nueva contrasena debe tener minimo 8 caracteres.' };
      return;
    }
    if (next !== confirm) {
      this.masterMessage = { type: 'error', text: 'La confirmacion no coincide.' };
      return;
    }

    const ok = await this.master.rotateMaster(current, next);
    if (!ok) {
      this.masterMessage = { type: 'error', text: 'La contrasena actual no es correcta o hay un bloqueo temporal.' };
      return;
    }

    this.masterMessage = { type: 'success', text: 'Contrasena maestra actualizada. Se ha bloqueado para reingresar con la nueva clave.' };
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
    this.attemptMessage = `Intentos libres: ${this.freeAttempts}. Despues, delay inicial ${this.baseDelaySeconds}s creciendo x${this.growthFactor}.`;
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
    return 'Duplicado';
  }

  onLanguageChange(): void {
    const label = this.language === 'en' ? 'English' : this.language === 'fr' ? 'Francais' : 'Espanol';
    this.languageMessage = `Idioma preferido: ${label}.`;
  }

  async onExportVault(password: string): Promise<void> {
    this.exportMessage = undefined;
    this.exporting = true;
    try {
      const res = await this.es.exportVault('master', password);
      const payload = res.payload ?? { format: res.format, enc: res.enc, data: res.base64 };
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename || 'keyping-vault.kpenc';
      a.click();
      URL.revokeObjectURL(url);
      this.exportMessage = 'Vault exportado y cifrado con tu contrasena.';
    } catch (err) {
      console.error('[settings] export error', err);
      this.exportMessage = 'No se pudo exportar el vault.';
    } finally {
      this.exporting = false;
    }
  }

  openExportModal(): void {
    this.exportModal = { visible: true, password: '', error: '' };
  }

  closeExportModal(): void {
    this.exportModal.visible = false;
    this.exportModal.password = '';
    this.exportModal.error = '';
  }

  async confirmExport(): Promise<void> {
    if (!this.exportModal.password.trim()) {
      this.exportModal.error = 'Introduce tu contrasena maestra.';
      return;
    }
    const ok = await this.master.verifyMaster(this.exportModal.password.trim());
    if (!ok) {
      this.exportModal.error = 'Contrasena maestra incorrecta.';
      return;
    }

    this.exportModal.error = '';
    await this.onExportVault(this.exportModal.password.trim());
    this.closeExportModal();
  }

  onModeChange(): void {
    this.importMessage = undefined;
    this.importState = undefined;
    this.importPassword = '';
    this.importPasswordError = undefined;
    this.rawImportText = '';
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
    this.importPassword = '';
    this.importPasswordError = undefined;

    try {
      const text = await file.text();
      this.rawImportText = text;
      const parsed = await this.es.parseImport(text);
      const rawFile = this.safeParse(text);

      this.importEntries = parsed.entries || [];
      this.importSource = parsed.source;
      this.importEncrypted =
        rawFile?.format === 'keyping-export-v1' && typeof rawFile?.vault === 'string'
          ? rawFile.vault
          : undefined;

      if (parsed.requiresPassword) {
        this.mergePreview = [];
        this.importMessage = 'Archivo cifrado: introduce la contrasena usada al exportar.';
        this.importState = 'info';
        return;
      }

      this.mergePreview = this.importEntries.slice(0, 50).map((raw, idx) => ({
        idx,
        label: raw?.label || (raw as any)?.name || (raw as any)?.title || `Entrada ${idx + 1}`,
        username: raw?.username || (raw as any)?.user,
        email: raw?.email,
        selected: true,
        reason: this.classifyImportEntry(raw)
      }));

      if (this.importMode === 'overwrite') {
        this.importMessage = 'Archivo listo. Se sobrescribira el vault actual.';
        this.importState = 'success';
      } else {
        const count = this.mergePreview.length;
        this.importMessage = count
          ? `Vista previa lista: ${count} contrasenas para fusionar.`
          : 'No se encontraron contrasenas en el archivo.';
        this.importState = count ? 'success' : 'info';
      }
    } catch (err) {
      console.error('[settings] import parse error', err);
      this.importMessage = 'No se pudo leer el archivo. Asegurate de que sea el archivo de importacion generado.';
      this.mergePreview = [];
      this.importEntries = [];
      this.importEncrypted = undefined;
      this.importSource = null;
      this.importState = 'error';
    } finally {
      input.value = '';
    }
  }

  async onUnlockImport(): Promise<void> {
    if (!this.rawImportText || !this.importPassword.trim()) {
      this.importPasswordError = 'Introduce la contrasena del backup.';
      return;
    }
    this.importPasswordError = undefined;
    try {
      const parsed = await this.es.parseImport(this.rawImportText, this.importPassword);
      this.importEntries = parsed.entries || [];
      this.importSource = parsed.source;
      this.mergePreview = this.importEntries.slice(0, 50).map((raw, idx) => ({
        idx,
        label: raw?.label || (raw as any)?.name || (raw as any)?.title || `Entrada ${idx + 1}`,
        username: raw?.username || (raw as any)?.user,
        email: raw?.email,
        selected: true,
        reason: this.classifyImportEntry(raw)
      }));

      const count = this.mergePreview.length;
      this.importMessage = count
        ? `Vista previa lista: ${count} contrasenas para fusionar.`
        : 'No se encontraron contrasenas en el archivo.';
      this.importState = count ? 'success' : 'info';
    } catch (err) {
      console.error('[settings] import unlock error', err);
      this.importMessage = 'No se pudo descifrar el backup. Revisa la contrasena.';
      this.importState = 'error';
    }
  }

  applyImport(): void {
    if (this.importMode === 'overwrite') {
      this.openConfirmModal('overwrite');
      return;
    }

    if (!this.mergePreview.length) {
      this.importMessage = 'Carga un archivo para elegir que fusionar.';
      this.importState = 'info';
      return;
    }

    const selected = this.mergePreview.filter(item => item.selected).length;
    this.importMessage = selected
      ? `Fusionaras ${selected} contrasenas del archivo importado.`
      : 'Has descartado todas las nuevas contrasenas.';
    this.importState = selected ? 'success' : 'info';

    if (selected > 0) {
      this.runImport('merge');
    }
  }

  selectAllMerge(selected: boolean): void {
    this.mergePreview = this.mergePreview.map(item => ({ ...item, selected }));
  }

  get filteredMergePreview(): MergePreviewItem[] {
    const term = this.mergeFilter.trim().toLowerCase();
    if (!term) return this.mergePreview;
    return this.mergePreview.filter(item => {
      return (
        (item.label && item.label.toLowerCase().includes(term)) ||
        (item.username && item.username.toLowerCase().includes(term)) ||
        (item.email && item.email.toLowerCase().includes(term)) ||
        item.reason.toLowerCase().includes(term)
      );
    });
  }

  private currentEntryFor(item: MergePreviewItem): VaultImportEntry | undefined {
    const incoming = this.importEntries[item.idx];
    if (incoming?.id) {
      const byId = this.currentEntries.find(e => e.id === incoming.id);
      if (byId) return byId;
    }
    const norm = (v: any) => (v ?? '').toString().toLowerCase().trim();
    const label = norm(incoming?.label);
    const user = norm((incoming as any)?.username || (incoming as any)?.user);
    const email = norm(incoming?.email);
    const login = norm((incoming as any)?.loginUrl);
    return this.currentEntries.find(e => {
      return (
        (label && norm(e.label) === label) ||
        (user && norm((e as any).username) === user) ||
        (email && norm((e as any).email) === email) ||
        (login && norm((e as any).loginUrl) === login)
      );
    });
  }

  private incomingEntry(item: MergePreviewItem): VaultImportEntry | undefined {
    return this.importEntries[item.idx];
  }

  formatDate(ts?: number): string {
    if (!ts) return '-';
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return '-';
    }
  }

  discardExisting(): void {
    this.mergePreview = this.mergePreview.map(item =>
      item.reason === 'existing' ? { ...item, selected: false } : item
    );
  }

  onTipEnter(event: MouseEvent, item: MergePreviewItem): void {
    const rows = this.entryTip(item);
    if (!rows || !rows.length) {
      this.tooltip.visible = false;
      return;
    }
    this.tooltip = {
      rows,
      x: event.clientX + 12,
      y: event.clientY + 12,
      visible: true
    };
  }

  onTipMove(event: MouseEvent): void {
    if (!this.tooltip.visible) return;
    this.tooltip.x = event.clientX + 12;
    this.tooltip.y = event.clientY + 12;
  }

  onTipLeave(): void {
    this.tooltip.visible = false;
  }

  entryTip(item: MergePreviewItem): TipRow[] | null {
    const incoming = this.incomingEntry(item);
    if (!incoming) return null;
    const includeCurrent = item.reason === 'conflict';
    const curr = includeCurrent ? this.currentEntryFor(item) : undefined;

    const rows: TipRow[] = [];
    const addRow = (label: string, fromVal: any, toVal: any, isDate = false) => {
      const displayFrom = includeCurrent ? this.displayVal(fromVal, isDate) : '--';
      const displayTo = this.displayVal(toVal, isDate);
      const hasFrom = includeCurrent && this.hasValue(fromVal);
      const hasTo = this.hasValue(toVal);
      const same = this.equalsVal(fromVal, toVal, isDate);
      let tone: TipRow['tone'] = 'same';
      if (!hasFrom && hasTo) tone = 'add';
      else if (hasFrom && !hasTo) tone = 'remove';
      else if (hasFrom && hasTo && !same) tone = 'change';
      else tone = 'same';
      if (!hasFrom && !hasTo) return;
      rows.push({ label, from: displayFrom, to: displayTo, tone });
    };

    addRow('Label', curr?.label, incoming.label || (incoming as any).title || (incoming as any).name);
    addRow('Usuario', (curr as any)?.username, (incoming as any)?.username);
    addRow('Email', (curr as any)?.email, (incoming as any)?.email);
    addRow('Login', (curr as any)?.loginUrl, (incoming as any)?.loginUrl);

    return rows;
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

      if (this.importSource === 'master' && !this.importEntries.length) {
        this.importMessage = 'Introduce la contrasena y pulsa \"Desbloquear backup\" para previsualizar.';
        this.importState = 'info';
        return;
      }

      const selectedEntries =
        mode === 'merge'
          ? this.mergePreview
              .map((item, idx) => {
                if (!item.selected) return null;
                const entry = { ...this.importEntries[idx] };
                if (item.reason === 'conflict') {
                  entry.label = `${entry.label || entry.username || entry.email || 'Entrada'} - Conflicto`;
                } else if (item.reason === 'existing') {
                  entry.label = `${entry.label || entry.username || entry.email || 'Entrada'} - Duplicado`;
                }
                return entry;
              })
              .filter((e): e is VaultImportEntry => !!e)
          : this.importEntries;

      const now = Date.now();
      const stampedEntries = selectedEntries.map(entry => ({
        ...entry,
        updatedAt: now,
        createdAt: (entry as any).createdAt ?? now
      }));

      const enc = this.importSource === 'encrypted' ? 'native' : this.importSource || 'plain';

      const res = await this.es.importVault(
        mode,
        stampedEntries,
        this.importEncrypted,
        enc,
        this.importPassword,
        this.importSource === 'master' ? this.safeParse(this.rawImportText || '{}') : undefined
      );
      this.importState = 'success';
      this.importMessage =
        mode === 'overwrite'
          ? `Vault sobrescrito (${res.imported} entradas).`
          : `Fusionadas ${res.imported} contrasenas nuevas.`;
      await this.passwordCountSvc.refreshFromDisk();
      await this.loadCurrentVaultIds();
    } catch (err) {
      console.error('[settings] import error', err);
      this.importState = 'error';
      this.importMessage = 'No se pudo importar el archivo.';
    } finally {
      this.importing = false;
    }
  }

  private openConfirmModal(mode: 'overwrite' | 'merge'): void {
    this.confirmModal = { visible: true, countdown: 5, mode };
    clearInterval(this.countdownTimer);
    this.countdownTimer = setInterval(() => {
      this.confirmModal.countdown = Math.max(0, this.confirmModal.countdown - 1);
      if (this.confirmModal.countdown <= 0) {
        clearInterval(this.countdownTimer);
      }
    }, 1000);
  }

  closeConfirmModal(): void {
    this.confirmModal.visible = false;
    clearInterval(this.countdownTimer);
  }

  confirmImport(): void {
    if (!this.confirmModal.visible || this.confirmModal.countdown > 0) return;
    const mode = this.confirmModal.mode;
    this.closeConfirmModal();
    this.runImport(mode);
  }

  private safeParse(text: string): any {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  private async loadCurrentVaultIds(): Promise<void> {
    try {
      const entries = await this.es.listPasswords();
      this.currentIds = new Set(entries.map(e => e.id));
      this.currentEntries = entries.map(e => ({
        id: e.id,
        label: e.label,
        username: (e as any).username,
        email: (e as any).email,
        loginUrl: (e as any).loginUrl
      }));
    } catch (err) {
      console.error('[settings] unable to load current vault ids', err);
      this.currentIds = new Set();
      this.currentEntries = [];
    }
  }

  private classifyImportEntry(raw: any): MergeReason {
    if (raw?.id && this.currentIds.has(raw.id)) {
      return this.isUpdatedExisting(raw) ? 'conflict' : 'existing';
    }
    if (this.isConflict(raw)) return 'conflict';
    if ((raw as any)?.conflict) return 'conflict';
    return 'new';
  }

  private isUpdatedExisting(raw: any): boolean {
    if (!raw?.id) return false;
    const current = this.currentEntries.find(e => e.id === raw.id);
    if (!current) return false;
    const norm = (v: any) => (v ?? '').toString().trim().toLowerCase();
    const sameLabel = norm(raw.label) === norm(current.label);
    const sameUser = norm((raw as any).username || (raw as any).user) === norm((current as any).username);
    const sameEmail = norm(raw.email) === norm((current as any).email);
    const sameLogin = norm(raw.loginUrl) === norm((current as any).loginUrl);
    return !(sameLabel && sameUser && sameEmail && sameLogin);
  }

  private isConflict(raw: any): boolean {
    if (!raw) return false;
    const targetLabel = (raw.label || (raw as any)?.name || '').toString().toLowerCase().trim();
    const targetUser = (raw.username || (raw as any)?.user || '').toString().toLowerCase().trim();
    const targetEmail = (raw.email || '').toString().toLowerCase().trim();
    const targetLogin = (raw.loginUrl || '').toString().toLowerCase().trim();

    return this.currentEntries.some(e => {
      if (!e) return false;
      const label = (e.label || '').toLowerCase();
      const user = ((e as any).username || '').toLowerCase();
      const email = ((e as any).email || '').toLowerCase();
      const login = ((e as any).loginUrl || '').toLowerCase();

      const sameLabel = !!targetLabel && targetLabel === label;
      const sameUser = !!targetUser && targetUser === user;
      const sameEmail = !!targetEmail && targetEmail === email;
      const sameLogin = !!targetLogin && targetLogin === login;

      // Conflict if matches by any identifying field but id differs
      return (sameLabel || sameUser || sameEmail || sameLogin);
    });
  }

  private hasValue(v: any): boolean {
    if (v === null || v === undefined) return false;
    if (typeof v === 'string' && v.trim() === '') return false;
    return true;
  }

  private displayVal(v: any, isDate = false): string {
    if (isDate) return this.formatDate(v);
    if (!this.hasValue(v)) return '--';
    return String(v);
  }

  private equalsVal(a: any, b: any, isDate = false): boolean {
    if (isDate) return a === b;
    const norm = (x: any) => (x ?? '').toString().trim().toLowerCase();
    return norm(a) === norm(b);
  }
}
