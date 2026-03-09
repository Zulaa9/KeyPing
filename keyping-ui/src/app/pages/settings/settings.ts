import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgIf, NgFor, NgClass, NgStyle } from '@angular/common';
import { ElectronService, VaultImportEntry } from '../../core/electron.service';
import { MasterLockService } from '../../core/master-lock.service';
import { PasswordCountService } from '../../core/password-count.service';
import { I18nService } from '../../core/i18n.service';
import { Subscription } from 'rxjs';
import { TranslatePipe } from '../../core/translate.pipe';
import { AppUpdateService } from '../../core/app-update.service';
import { UpdatePreferences, UpdateState } from '../../core/update.types';

type MergeReason = 'new' | 'conflict' | 'existing';

type MergePreviewItem = {
  idx: number;
  label: string;
  username?: string;
  email?: string;
  selected: boolean;
  reason: MergeReason;
};

type StatusMsg = { type: 'success' | 'error' | 'info'; key: string; params?: Record<string, string | number> };
type TipRow = { label: string; from: string; to: string; tone: 'add' | 'remove' | 'change' | 'same' };

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule, NgIf, NgFor, NgClass, NgStyle, TranslatePipe],
  templateUrl: './settings.html',
  styleUrls: ['./settings.scss']
})
export class SettingsComponent implements OnInit, OnDestroy {
  // Estado de formularios y mensajes de la pantalla de ajustes.
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
  exportIncludeHistory = true;

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
  private langSub?: Subscription;
  private updateStateSub?: Subscription;
  private updatePreferencesSub?: Subscription;
  historyLimit = 20;
  historySettingsMessage?: string;
  historyCompactMessage?: string;
  historyKeepMessage?: string;
  historyBusy = false;
  historyKeepBusy = false;
  historyCompactFailed = false;
  historyKeepFailed = false;
  updateState: UpdateState = { status: 'idle', currentVersion: '0.0.0' };
  updatePreferences: UpdatePreferences = {
    autoCheck: true,
    autoDownload: false,
    installOnQuit: true
  };
  updateMessage?: string;
  updateMessageType: 'success' | 'error' | 'info' = 'info';
  updateBusy = false;

  constructor(
    private es: ElectronService,
    private master: MasterLockService,
    private passwordCountSvc: PasswordCountService,
    private i18n: I18nService,
    private updates: AppUpdateService
  ) {}

  ngOnInit(): void {
    this.autoLockMinutes = this.master.getAutoLockMinutes();
    const policy = this.master.getAttemptPolicy();
    this.freeAttempts = policy.freeAttempts;
    this.baseDelaySeconds = Math.round(policy.baseDelayMs / 1000);
    this.growthFactor = policy.growthFactor;
    this.loadCurrentVaultIds();
    this.language = this.i18n.currentLanguage;
    this.langSub = this.i18n.language$.subscribe(lang => {
      this.language = lang;
    });
    this.updateStateSub = this.updates.state$.subscribe(state => {
      this.updateState = state;
    });
    this.updatePreferencesSub = this.updates.preferences$.subscribe(preferences => {
      this.updatePreferences = preferences;
    });
    void this.loadHistorySettings();
    void this.updates.initialize();
  }

  ngOnDestroy(): void {
    this.langSub?.unsubscribe();
    this.updateStateSub?.unsubscribe();
    this.updatePreferencesSub?.unsubscribe();
    clearInterval(this.countdownTimer);
  }

  async onUpdateMaster(): Promise<void> {
    this.masterMessage = undefined;
    const { current, next, confirm } = this.masterForm;
    if (!current || !next || !confirm) {
      this.masterMessage = { type: 'error', key: 'settings.master.error.fill' };
      return;
    }
    if (next.length < 8) {
      this.masterMessage = { type: 'error', key: 'settings.master.error.min' };
      return;
    }
    if (next !== confirm) {
      this.masterMessage = { type: 'error', key: 'settings.master.error.confirm' };
      return;
    }

    const ok = await this.master.rotateMaster(current, next);
    if (!ok) {
      this.masterMessage = { type: 'error', key: 'settings.master.error.invalid' };
      return;
    }

    this.masterMessage = { type: 'success', key: 'settings.master.success' };
    this.masterForm = { current: '', next: '', confirm: '' };
  }

  resetMasterForm(): void {
    this.masterForm = { current: '', next: '', confirm: '' };
    this.masterMessage = undefined;
  }

  onSaveAutoLock(): void {
    this.master.setAutoLockMinutes(this.autoLockMinutes);
    this.autoLockMinutes = this.master.getAutoLockMinutes();
    this.autoLockMessage = this.t('settings.autolock.saved', { value: this.autoLockMinutes });
  }

  onSaveAttempts(): void {
    this.master.setAttemptPolicy(
      this.freeAttempts,
      this.baseDelaySeconds * 1000,
      this.growthFactor
    );
    this.attemptMessage = this.t('settings.attempts.saved', {
      free: this.freeAttempts,
      delay: this.baseDelaySeconds,
      growth: this.growthFactor
    });
  }

  async onSaveHistoryLimit(): Promise<void> {
    this.historySettingsMessage = undefined;
    const limit = Math.max(1, Math.min(200, Math.round(this.historyLimit)));
    this.historyLimit = limit;
    try {
      const res = await this.es.updateHistorySettings(this.historyLimit);
      this.historyLimit = res.maxHistoryPerEntry;
      this.historySettingsMessage = this.t('settings.history.saved', { value: res.maxHistoryPerEntry });
    } catch (err) {
      console.error('[settings] history limit error', err);
      this.historySettingsMessage = this.t('settings.history.errorSaving');
    }
  }

  async onCompactHistory(): Promise<void> {
    if (this.historyBusy) return;
    this.historyBusy = true;
    this.historyCompactFailed = false;
    this.historyCompactMessage = undefined;
    try {
      const res = await this.es.compactVault(false, this.historyLimit);
      this.historyCompactMessage = this.t('settings.history.compactDone', { removed: res.removed });
      this.historyCompactFailed = false;
    } catch (err) {
      console.error('[settings] compact history failed', err);
      this.historyCompactMessage = this.t('settings.history.compactError');
      this.historyCompactFailed = true;
    } finally {
      this.historyBusy = false;
    }
  }

  async onKeepOnlyCurrentHistory(): Promise<void> {
    if (this.historyKeepBusy) return;
    this.historyKeepBusy = true;
    this.historyKeepFailed = false;
    this.historyKeepMessage = undefined;
    try {
      const res = await this.es.compactVault(true);
      this.historyKeepMessage = this.t('settings.history.keepDone', { removed: res.removed });
      this.historyKeepFailed = false;
    } catch (err) {
      console.error('[settings] keep only current history failed', err);
      this.historyKeepMessage = this.t('settings.history.keepError');
      this.historyKeepFailed = true;
    } finally {
      this.historyKeepBusy = false;
    }
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
    if (reason === 'new') return this.t('settings.import.reason.new');
    if (reason === 'conflict') return this.t('settings.import.reason.conflict');
    return this.t('settings.import.reason.duplicate');
  }

  async onLanguageChange(): Promise<void> {
    await this.i18n.use(this.language);
    const label = this.languageLabel(this.language);
    this.languageMessage = this.i18n.translate('settings.language.saved', { lang: label });
  }

  async onExportVault(password: string, includeHistory = true): Promise<void> {
    this.exportMessage = undefined;
    this.exporting = true;
    try {
      const res = await this.es.exportVault('master', password, includeHistory);
      const payload = res.payload ?? { format: res.format, enc: res.enc, data: res.base64 };
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename || 'keyping-vault.kpenc';
      a.click();
      URL.revokeObjectURL(url);
      this.exportMessage = this.t('settings.export.success');
    } catch (err) {
      console.error('[settings] export error', err);
      this.exportMessage = this.t('settings.export.error');
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
      this.exportModal.error = this.t('settings.export.modal.errorRequired');
      return;
    }
    const ok = await this.master.verifyMaster(this.exportModal.password.trim());
    if (!ok) {
      this.exportModal.error = this.t('settings.export.modal.errorInvalid');
      return;
    }

    this.exportModal.error = '';
    await this.onExportVault(this.exportModal.password.trim(), this.exportIncludeHistory);
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
      // Parseo único para construir preview y detectar si requiere contraseña maestra.
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
        this.importMessage = this.t('settings.import.msg.encrypted');
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
        this.importMessage = this.t('settings.import.msg.readyOverwrite');
        this.importState = 'success';
      } else {
        const count = this.mergePreview.length;
        this.importMessage = count
          ? this.t('settings.import.msg.previewMerge', { count })
          : this.t('settings.import.msg.emptyFile');
        this.importState = count ? 'success' : 'info';
      }
    } catch (err) {
      console.error('[settings] import parse error', err);
      this.importMessage = this.t('settings.import.msg.readError');
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
      this.importPasswordError = this.t('settings.import.masterRequired');
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
        ? this.t('settings.import.msg.previewMerge', { count })
        : this.t('settings.import.msg.emptyFile');
      this.importState = count ? 'success' : 'info';
    } catch (err) {
      console.error('[settings] import unlock error', err);
      this.importMessage = this.t('settings.import.msg.unlockError');
      this.importState = 'error';
    }
  }

  applyImport(): void {
    if (this.importMode === 'overwrite') {
      this.openConfirmModal('overwrite');
      return;
    }

    if (!this.mergePreview.length) {
      this.importMessage = this.t('settings.import.msg.mergeEmpty');
      this.importState = 'info';
      return;
    }

    const selected = this.mergePreview.filter(item => item.selected).length;
    this.importMessage = selected
      ? this.t('settings.import.msg.mergeSelected', { count: selected })
      : this.t('settings.import.msg.mergeNone');
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

    addRow(this.t('settings.tip.label'), curr?.label, incoming.label || (incoming as any).title || (incoming as any).name);
    addRow(this.t('settings.tip.username'), (curr as any)?.username, (incoming as any)?.username);
    addRow(this.t('settings.tip.email'), (curr as any)?.email, (incoming as any)?.email);
    addRow(this.t('settings.tip.login'), (curr as any)?.loginUrl, (incoming as any)?.loginUrl);

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
        this.importMessage = this.t('settings.import.msg.needFile');
        this.importState = 'info';
        return;
      }

      if (this.importSource === 'master' && !this.importEntries.length) {
        this.importMessage = this.t('settings.import.msg.masterHint');
        this.importState = 'info';
        return;
      }

      const selectedEntries =
        mode === 'merge'
          ? this.mergePreview
              .map((item, idx) => {
                if (!item.selected) return null;
                const entry = { ...this.importEntries[idx] };
                const baseLabel = entry.label || entry.username || entry.email || this.t('settings.import.entryFallback');
                entry.label = baseLabel;
                if (item.reason === 'conflict') {
                  entry.label = `${baseLabel} - ${this.t('settings.import.conflictSuffix')}`;
                } else if (item.reason === 'existing') {
                  entry.label = `${baseLabel} - ${this.t('settings.import.duplicateSuffix')}`;
                }
                return entry;
              })
              .filter((e): e is VaultImportEntry => !!e)
          : this.importEntries;

      // Homogeneiza timestamps de import para que las vistas ordenen de forma estable.
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
          ? this.t('settings.import.msg.doneOverwrite', { count: res.imported })
          : this.t('settings.import.msg.doneMerge', { count: res.imported });
      await this.passwordCountSvc.refreshFromDisk();
      await this.loadCurrentVaultIds();
    } catch (err) {
      console.error('[settings] import error', err);
      this.importState = 'error';
      this.importMessage = this.t('settings.import.msg.fail');
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

  private async loadHistorySettings(): Promise<void> {
    try {
      const settings = await this.es.getHistorySettings();
      this.historyLimit = settings.maxHistoryPerEntry;
    } catch (err) {
      console.error('[settings] load history settings failed', err);
    }
  }

  private classifyImportEntry(raw: any): MergeReason {
    // Si el id existe, distinguimos entre entrada idéntica y entrada actualizada.
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

      // Hay conflicto si coincide por algún identificador aunque cambie el id.
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

  renderMsg(msg?: StatusMsg): string {
    if (!msg) return '';
    return this.t(msg.key, msg.params);
  }

  private t(key: string, params?: Record<string, string | number>): string {
    return this.i18n.translate(key, params);
  }

  private languageLabel(lang: string): string {
    const key = `language.name.${lang}`;
    const value = this.i18n.translate(key);
    return value === key ? lang.toUpperCase() : value;
  }

  async onCheckUpdates(): Promise<void> {
    this.updateMessage = undefined;
    this.updateBusy = true;
    try {
      const next = await this.updates.checkForUpdates(true);
      this.updateState = next;
      if (next.status === 'upToDate') {
        this.updateMessage = this.t('settings.updates.messages.upToDate');
        this.updateMessageType = 'info';
      }
    } catch (err) {
      console.error('[settings] check updates failed', err);
      this.updateMessage = this.t('settings.updates.messages.error');
      this.updateMessageType = 'error';
    } finally {
      this.updateBusy = false;
    }
  }

  async onDownloadUpdate(): Promise<void> {
    this.updateMessage = undefined;
    this.updateBusy = true;
    try {
      await this.updates.downloadUpdate();
    } catch (err) {
      console.error('[settings] download update failed', err);
      this.updateMessage = this.t('settings.updates.messages.error');
      this.updateMessageType = 'error';
    } finally {
      this.updateBusy = false;
    }
  }

  async onInstallUpdate(): Promise<void> {
    this.updateMessage = undefined;
    this.updateBusy = true;
    try {
      const ok = await this.updates.installUpdateAndRestart();
      if (!ok) {
        this.updateMessage = this.t('settings.updates.messages.notReady');
        this.updateMessageType = 'info';
      }
    } catch (err) {
      console.error('[settings] install update failed', err);
      this.updateMessage = this.t('settings.updates.messages.error');
      this.updateMessageType = 'error';
    } finally {
      this.updateBusy = false;
    }
  }

  async onPostponeUpdate(): Promise<void> {
    this.updateMessage = undefined;
    await this.updates.postponeUpdate();
    this.updateMessage = this.t('settings.updates.messages.postponed');
    this.updateMessageType = 'info';
  }

  async onToggleUpdatePreference(key: keyof UpdatePreferences, value: boolean): Promise<void> {
    this.updateMessage = undefined;
    this.updateBusy = true;
    try {
      const next = await this.updates.setPreferences({ [key]: value } as Partial<UpdatePreferences>);
      this.updatePreferences = next;
      this.updateMessage = this.t('settings.updates.messages.saved');
      this.updateMessageType = 'success';
    } catch (err) {
      console.error('[settings] update preferences failed', err);
      this.updateMessage = this.t('settings.updates.messages.error');
      this.updateMessageType = 'error';
    } finally {
      this.updateBusy = false;
    }
  }
}
