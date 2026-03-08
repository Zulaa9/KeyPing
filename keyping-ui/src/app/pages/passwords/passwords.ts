import { ChangeDetectorRef, Component, HostListener, OnInit } from '@angular/core';
import {
  NgFor,
  NgIf,
  NgClass,
  UpperCasePipe,
  NgSwitch,
  NgSwitchCase,
  NgSwitchDefault,
  NgStyle
} from '@angular/common';

import { FormsModule } from '@angular/forms';
import { ElectronService, PasswordMeta } from '../../core/electron.service';
import { PasswordCountService } from '../../core/password-count.service';
import { Router, ActivatedRoute } from '@angular/router';
import { MasterLockService } from '../../core/master-lock.service';
import { TranslatePipe } from '../../core/translate.pipe';
import { I18nService } from '../../core/i18n.service';
import { SERVICE_ICON_ASSETS } from '../../core/icons/icon-registry';
import { resolveEntryIcon } from '../../core/icons/service-icon.resolver';

type StrengthFilter = 'all' | 'strong' | 'medium' | 'weak';

@Component({
  selector: 'app-passwords',
  standalone: true,
  imports: [
    NgFor,
    NgIf,
    NgClass,
    UpperCasePipe,
    NgSwitch,
    NgSwitchCase,
    NgSwitchDefault,
    FormsModule,
    NgStyle,
    TranslatePipe
  ],
  templateUrl: './passwords.html',
  styleUrls: ['./passwords.scss']
})
export class PasswordsComponent implements OnInit {
  loading = true;
  entries: PasswordMeta[] = [];
  listCollapsed = false;
  folderOrder: string[] = [];
  itemOrder: Record<string, string[]> = {};
  draggingFolder: string | null = null;
  folderDropTarget: string | null = null;
  draggingEntryId: string | null = null;
  draggingEntryFolder: string | null = null;
  entryDropTarget: string | null = null;
  private dragGhostEl: HTMLElement | null = null;

  // Termino de busqueda
  searchTerm = '';
  strengthFilter: StrengthFilter = 'all';
  onlyNoTwoFactor = false;
  onlyDuplicates = false;
  dateFilterMode: 'any' | 'created' | 'updated' = 'any';
  dateFrom = '';
  dateTo = '';
  duplicateIds = new Set<string>();
  filtersCollapsed = true;
  folderMenu: { visible: boolean; x: number; y: number; folder: string } = {
    visible: false,
    x: 0,
    y: 0,
    folder: ''
  };
  folderActionInProgress = false;
  renamingFolder: string | null = null;
  renameValue = '';

  // copiar
  copyingId: string | null = null;
  copySecondsLeft = 0;
  private copyTimer: any;

  // editar
  editingId: string | null = null;
  newPwd = '';

  // detalle seleccionado
  selected: PasswordMeta | null = null;

  // mapa: id -> contraseña revelada (texto claro SOLO en memoria del renderer)
  revealed: Record<string, string | undefined> = {};

  editingDetail = false;
  editLabel = '';
  editPwd = '';
  editLoginUrl = '';
  editPasswordChangeUrl = '';
  editEmail = '';
  editUsername = '';
  editTwoFactorEnabled = false;
  editFolder = '';
  collapsedFolders = new Set<string>();
  private readonly defaultFolderKey = '__default__';
  private readonly folderOrderStorageKey = 'keyping.folderOrder';
  private readonly itemOrderStorageKey = 'keyping.itemOrder';
  history: PasswordMeta[] = [];
  historyLoading = false;
  historyError?: string;
  historyModalOpen = false;
  showDemo = false;
  demoEntries: PasswordMeta[] = this.buildDemoEntries();
  demoHistory: PasswordMeta[] = [];
  private brokenIconAssets = new Set<string>();


  constructor(
    private es: ElectronService,
    private passwordCountSvc: PasswordCountService,
    private router: Router,
    private route: ActivatedRoute,
    private master: MasterLockService,
    private i18n: I18nService,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadEntries();

    const preselect = this.route.snapshot.queryParamMap.get('select');
    if (preselect) {
      const match = this.entries.find(e => e.id === preselect);
      if (match) {
        this.selected = match;
      }
    }
  }

  async loadEntries(): Promise<void> {
    this.loading = true;
    const previouslySelectedId = this.selected?.id;
    try {
      this.entries = await this.es.listPasswords();
      this.passwordCountSvc.setLocalCount(this.entries.length);
      this.showDemo = this.entries.length === 0 && this.isDemoAllowed();
      this.syncOrderingState();
      if (previouslySelectedId && !this.showDemo) {
        this.selected = this.entries.find(e => e.id === previouslySelectedId) || null;
      }
      this.master.persistVault(this.entries);
      await this.refreshDuplicateIndex();
      if (this.showDemo) {
        this.selected = this.demoEntries[0] || null;
        this.history = [];
        this.historyModalOpen = false;
        return;
      }
      if (this.selected) {
        await this.loadHistory(this.selected.id);
      } else {
        this.history = [];
      }
    } finally {
      this.loading = false;
    }
  }

  private async loadHistory(entryId: string): Promise<void> {
    this.historyLoading = true;
    this.historyError = undefined;
    try {
      this.history = await this.es.getPasswordHistory(entryId);
    } catch (err) {
      console.error('[renderer] history load error', err);
      this.historyError = this.t('passwords.history.error');
      this.history = [];
    } finally {
      this.historyLoading = false;
    }
  }

  private async refreshDuplicateIndex(): Promise<void> {
    this.duplicateIds = new Set<string>();
    if (!this.entries.length) return;

    const map = new Map<string, string[]>();

    for (const entry of this.entries) {
      try {
        const plain = await this.es.getPassword(entry.id);
        if (!plain) continue;
        if (!map.has(plain)) {
          map.set(plain, []);
        }
        map.get(plain)!.push(entry.id);
      } catch (err) {
        console.error('[renderer] duplicate scan failed', err);
      }
    }

    const dupes = new Set<string>();
    for (const ids of map.values()) {
      if (ids.length > 1) {
        ids.forEach(id => dupes.add(id));
      }
    }

    this.duplicateIds = dupes;
  }

  get hasActiveFilters(): boolean {
    return (
      this.strengthFilter !== 'all' ||
      this.onlyNoTwoFactor ||
      this.onlyDuplicates ||
      this.dateFilterMode !== 'any' ||
      !!this.dateFrom ||
      !!this.dateTo
    );
  }

  // Lista filtrada en base al searchTerm y filtros avanzados
  get filteredEntries(): PasswordMeta[] {
    const term = this.searchTerm.trim().toLowerCase();
    const fromTs = this.parseDateInput(this.dateFrom);
    const toTs = this.parseDateInput(this.dateTo, true);

    return this.baseEntries.filter(e => {
      if (term && !this.matchesSearch(e, term)) return false;
      if (this.strengthFilter !== 'all' && this.strengthLabel(e) !== this.strengthFilter) return false;
      if (this.onlyNoTwoFactor && e.twoFactorEnabled) return false;
      if (this.onlyDuplicates && !this.duplicateIds.has(e.id)) return false;
      if (!this.matchesDateRange(e, fromTs, toTs)) return false;
      return true;
    });
  }

  resetFilters(): void {
    this.strengthFilter = 'all';
    this.onlyNoTwoFactor = false;
    this.onlyDuplicates = false;
    this.dateFilterMode = 'any';
    this.clearDateFilter();
  }

  setStrengthFilter(level: StrengthFilter): void {
    this.strengthFilter = this.strengthFilter === level ? 'all' : level;
  }

  clearDateFilter(): void {
    this.dateFrom = '';
    this.dateTo = '';
  }

  toggleFilters(): void {
    this.filtersCollapsed = !this.filtersCollapsed;
  }

  // Lista filtrada + ordenada segun preferencia del usuario
  get orderedEntries(): PasswordMeta[] {
    const filtered = this.filteredEntries;
    return filtered.sort((a, b) => this.compareEntries(a, b));
  }

  private compareEntries(a: PasswordMeta, b: PasswordMeta): number {
    const folderA = this.normalizeFolder(a.folder);
    const folderB = this.normalizeFolder(b.folder);
    if (folderA !== folderB) {
      return this.folderIndex(folderA) - this.folderIndex(folderB);
    }

    const idxA = this.entryIndex(folderA, a.id);
    const idxB = this.entryIndex(folderB, b.id);
    if (idxA !== idxB) return idxA - idxB;

    return (a.label || '').localeCompare(b.label || '');
  }

  private folderIndex(folder: string): number {
    const idx = this.folderOrder.indexOf(folder);
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
  }

  private entryIndex(folder: string, id: string): number {
    const list = this.itemOrder[folder] || [];
    const idx = list.indexOf(id);
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
  }

  maskToChips(mask: number): string[] {
    const chips: string[] = [];
    if (mask & 1) chips.push('a-z');
    if (mask & 2) chips.push('A-Z');
    if (mask & 4) chips.push('0-9');
    if (mask & 8) chips.push('sym');
    return chips;
  }

  fmtDate(ts: number): string {
    return new Date(ts).toLocaleString();
  }

  private matchesSearch(entry: PasswordMeta, term: string): boolean {
    const normalizedTerm = term.trim().toLowerCase();
    if (this.matchesTwitterAlias(normalizedTerm)) {
      return this.isTwitterEntry(entry);
    }

    const folderRaw = (entry.folder || '').toLowerCase();
    const folderName = this.folderDisplayName(entry.folder || '').toLowerCase();

    const fields: (string | undefined)[] = [
      entry.label,
      (entry as any).username,
      (entry as any).email,
      entry.loginUrl,
      entry.passwordChangeUrl,
      folderRaw,
      folderName
    ];

    return fields.some(f => f && f.toLowerCase().includes(term));
  }

  private matchesTwitterAlias(term: string): boolean {
    if (!term) return false;
    if (term === 'x') return true;
    if (term.length < 2) return false;
    return 'twitter'.startsWith(term) || term.startsWith('twit');
  }

  private isTwitterEntry(entry: PasswordMeta): boolean {
    if (entry.detectedService === 'twitterx' || entry.iconName === 'twitterx') return true;

    const label = (entry.label || '').trim().toLowerCase();
    const loginUrl = (entry.loginUrl || '').toLowerCase();
    const username = ((entry as any).username || '').toLowerCase();
    const email = ((entry as any).email || '').toLowerCase();

    if (label === 'x' || label.includes('twitter')) return true;
    if (loginUrl.includes('x.com') || loginUrl.includes('twitter.com')) return true;
    if (username.includes('twitter') || email.includes('twitter')) return true;

    const resolved = resolveEntryIcon(entry);
    return resolved.serviceId === 'twitterx';
  }

  private parseDateInput(value: string, endOfDay = false): number | null {
    if (!value) return null;
    const ts = Date.parse(value);
    if (Number.isNaN(ts)) return null;
    return endOfDay ? ts + 24 * 60 * 60 * 1000 - 1 : ts;
  }

  private matchesDateRange(entry: PasswordMeta, from?: number | null, to?: number | null): boolean {
    const hasFrom = typeof from === 'number';
    const hasTo = typeof to === 'number';
    if (!hasFrom && !hasTo) return true;

    const created = entry.createdAt;
    const updated = entry.updatedAt || entry.createdAt;
    const target =
      this.dateFilterMode === 'created'
        ? created
        : this.dateFilterMode === 'updated'
          ? updated
          : Math.max(created, updated);

    if (hasFrom && target < (from as number)) return false;
    if (hasTo && target > (to as number)) return false;
    return true;
  }

  getDateLabel(entry: PasswordMeta): string {
    const hasUpdate = entry.updatedAt && entry.updatedAt !== entry.createdAt;
    const ts = hasUpdate ? entry.updatedAt! : entry.createdAt;
    const key = hasUpdate ? 'passwords.meta.updated' : 'passwords.meta.created';
    return this.t(key, { date: this.fmtDate(ts) });
  }

  folderDisplayName(folder: string): string {
    const normalized = this.normalizeFolder(folder);
    if (normalized === this.defaultFolderKey) {
      return this.t('passwords.defaultFolder');
    }
    return folder || this.t('passwords.defaultFolder');
  }

  twoFactorLabel(entry: PasswordMeta): string {
    return entry.twoFactorEnabled ? this.t('common.enabled') : this.t('common.disabled');
  }

  // mascara proporcional a la longitud
  maskPassword(len: number): string {
    return '*'.repeat(len || 8);
  }

  getSecondaryLine(entry: PasswordMeta): string | null {
    if (entry.username && entry.username.trim()) {
      return entry.username;
    }
    if (entry.email && entry.email.trim()) {
      return entry.email;
    }
    return null;
  }

  // ---- COPIAR ----
  async onCopy(entry: PasswordMeta): Promise<void> {
    if (this.showDemo) return;
    try {
      await this.es.copyPassword(entry.id);
      this.copyingId = entry.id;
      this.copySecondsLeft = 20;
      clearInterval(this.copyTimer);
      this.copyTimer = setInterval(() => {
        this.copySecondsLeft--;
        if (this.copySecondsLeft <= 0) {
          clearInterval(this.copyTimer);
          this.copyingId = null;
        }
      }, 1000);
    } catch (err) {
      console.error('[renderer] copy error', err);
    }
  }

  get groupedEntries(): { folder: string; items: PasswordMeta[] }[] {
    const map = new Map<string, PasswordMeta[]>();
    const list = this.orderedEntries;
    for (const e of list) {
      const folder = this.normalizeFolder(e.folder);
      if (!map.has(folder)) map.set(folder, []);
      map.get(folder)!.push(e);
    }
    return this.folderOrder
      .filter(f => map.has(f))
      .map(folder => ({ folder, items: map.get(folder)! }));
  }

  trackFolder(_index: number, group: { folder: string }): string {
    return group.folder;
  }

  trackEntry(_index: number, entry: PasswordMeta): string {
    return entry.id;
  }

  async copyText(value: string | undefined, ev?: MouseEvent): Promise<void> {
    if (ev) ev.stopPropagation();
    if (!value) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      }
    } catch (err) {
      console.error('[renderer] copy field error', err);
    }
  }

  // ---- ELIMINAR ----
  async onDelete(entry: PasswordMeta): Promise<void> {
    if (this.showDemo) return;
    const ok = confirm(this.t('passwords.confirm.delete'));
    if (!ok) return;

    await this.es.deletePassword(entry.id);
    await this.loadEntries();
    this.master.persistVault(this.entries);
    
    // EN CASO DE QUE NO SE ACTUALIZE CORRECTAMENTE EL CONTADOR AL ELIMINAR:
    //this.passwordCountSvc.setLocalCount(this.entries.length);

    if (this.selected?.id === entry.id) {
      this.selected = null;
    }

    delete this.revealed[entry.id];
  }

  // ---- EDITAR ----
  startEdit(entry: PasswordMeta): void {
    if (this.showDemo) return;
    this.editingId = entry.id;
    this.newPwd = '';
  }

  cancelEdit(): void {
    this.editingId = null;
    this.newPwd = '';
  }

  async confirmEdit(entry: PasswordMeta): Promise<void> {
    if (this.showDemo) return;
    if (!this.newPwd) return;

    const wasRevealed = !!this.revealed[entry.id];
    const wasSelected = this.selected?.id === entry.id;

    // 1) Actualizar password en el main (puede devolver mismo id o uno nuevo)
    const updated = await this.es.updatePassword(entry.id, this.newPwd);

    // 2) Limpiar estado de edicion inline
    this.editingId = null;
    this.newPwd = '';

    // 3) Limpiar el estado de "revelado" asociado al id antiguo
    delete this.revealed[entry.id];

    // 4) Recargar lista
    await this.loadEntries();
    this.master.persistVault(this.entries);

    // 5) Si el panel de detalle estaba abierto para esta entrada,
    //    volvemos a seleccionar la entrada actualizada
    if (wasSelected) {
      const newId = (updated as any)?.id ?? entry.id;
      const refreshed = this.entries.find(e => e.id === newId) || null;
      this.selected = refreshed;

      // 6) Si ANTES estaba mostrada, volvemos a mostrar la nueva contraseña
      if (wasRevealed && this.selected) {
        try {
          const plain = await this.es.getPassword(this.selected.id);
          if (plain) {
            this.revealed[this.selected.id] = plain;
          }
        } catch (err) {
          console.error('[renderer] reload revealed password failed', err);
        }
      }
      if (this.selected) {
        await this.loadHistory(this.selected.id);
      }
    }
  }

  // ---- DETALLE ----
  async onSelect(entry: PasswordMeta): Promise<void> {
    this.selected = entry;
    this.editingDetail = false;
    if (this.showDemo) {
      this.history = [];
      this.historyModalOpen = false;
      return;
    }
    await this.loadHistory(entry.id);
  }

  strengthLabel(entry: PasswordMeta): 'strong' | 'medium' | 'weak' {
    const variety = this.countVariety(entry.classMask || 0);
    const len = entry.length || 0;
    // Reutilizamos la misma lógica que en PasswordHealth (sin degradar por 2FA aquí)
    const hasFullVariety = variety >= 4;
    if ((len >= 20 && variety >= 3) || (len >= 16 && hasFullVariety)) return 'strong';
    if ((len >= 12 && variety >= 3) || (len >= 14 && variety >= 2)) return 'medium';
    return 'weak';
  }

  private countVariety(mask: number): number {
    let count = 0;
    if (mask & 1) count++;
    if (mask & 2) count++;
    if (mask & 4) count++;
    if (mask & 8) count++;
    return count;
  }

  toggleFolder(folder: string): void {
    const key = this.normalizeFolder(folder);
    if (this.collapsedFolders.has(key)) {
      this.collapsedFolders.delete(key);
    } else {
      this.collapsedFolders.add(key);
    }
  }

  isFolderCollapsed(folder: string): boolean {
    const key = this.normalizeFolder(folder);
    return this.collapsedFolders.has(key);
  }

  startDetailEdit(): void {
    if (this.showDemo) return;
    if (!this.selected) return;
    this.editingDetail = true;

    this.editLabel = this.selected.label || '';
    this.editPwd = '';
    this.editLoginUrl = this.selected.loginUrl || '';
    this.editPasswordChangeUrl = this.selected.passwordChangeUrl || '';
    this.editUsername = this.selected.username || '';
    this.editEmail = this.selected.email || '';
    this.editTwoFactorEnabled = !!this.selected.twoFactorEnabled;
    this.editFolder = this.selected.folder || '';

    // Si ya estaba revelada, usamos ese valor como base
    // (asi al entrar en editar, la ves directamente si ya la habias mostrado)
    this.editPwd = this.revealed[this.selected.id] || '';
  }
  
  async saveDetailEdit(): Promise<void> {
    if (this.showDemo) return;
    if (!this.selected) return;

    const oldId = this.selected.id;
    let currentId = oldId;
    const oldFolder = this.normalizeFolder(this.selected.folder);

    // 1) Si se ha escrito una nueva contraseña → updatePassword
    if (this.editPwd) {
      let currentPlain = this.revealed[oldId];
      if (!currentPlain) {
        try {
          const candidate = await this.es.getPassword(oldId);
          if (candidate) currentPlain = candidate;
        } catch (err) {
          console.error('[renderer] compare password failed', err);
        }
      }

      if (currentPlain !== this.editPwd) {
        const updated = await this.es.updatePassword(oldId, this.editPwd);
        const newId = updated.id;

        // si la contraseña estaba revelada, movemos el estado al nuevo id
        if (this.revealed[oldId]) {
          this.revealed[newId] = this.editPwd;
          delete this.revealed[oldId];
        }

        currentId = newId;
      }
    }

    const iconMeta = this.resolveIconMetaForEdit();

    // 2) Actualizar metadata (nombre / URLs) sobre el id actual (nuevo si ha cambiado)
    const updatedMeta = await this.es.updateMeta(
      currentId,
      this.editLabel || '',
      this.editLoginUrl || '',
      this.editPasswordChangeUrl || '',
      this.editUsername || '',
      this.editEmail || '',
      this.editFolder || '',
      this.editTwoFactorEnabled,
      iconMeta.iconName,
      iconMeta.iconSource,
      iconMeta.detectedService
    );

    // 3) Cerrar modo edicion pero mantener el panel abierto en la entrada actualizada
    this.editingDetail = false;
    this.editPwd = '';

    const newFolder = this.normalizeFolder(updatedMeta.folder);

    // Actualizar orden de items/folders en memoria
    const sourceList = (this.itemOrder[oldFolder] || this.getOrderedIdsForFolder(oldFolder)).filter(id => id !== oldId && id !== currentId);
    if (sourceList.length) {
      this.itemOrder[oldFolder] = sourceList;
    } else {
      delete this.itemOrder[oldFolder];
    }

    const destBase = (this.itemOrder[newFolder] || this.getOrderedIdsForFolder(newFolder)).filter(id => id !== oldId && id !== currentId);
    destBase.push(currentId);
    this.itemOrder[newFolder] = destBase;

    if (!this.folderOrder.includes(newFolder)) {
      this.folderOrder.push(newFolder);
    }

    if (oldFolder !== newFolder) {
      const remainingOld = this.entries.filter(e => this.normalizeFolder(e.folder) === oldFolder && e.id !== oldId).length;
      if (remainingOld === 0) {
        this.folderOrder = this.folderOrder.filter(f => f !== oldFolder);
      }
    }

    this.persistOrdering();

    // Actualizar lista en memoria
    const nextEntries = this.entries.filter(e => e.id !== oldId && e.id !== updatedMeta.id);
    nextEntries.push({
      ...this.selected,
      ...updatedMeta
    });
    this.entries = nextEntries;
    this.selected = nextEntries.find(e => e.id === currentId) || updatedMeta;
    this.master.persistVault(this.entries);
    if (this.selected) {
      await this.loadHistory(this.selected.id);
    }
  }

  cancelDetailEdit(): void {
    this.editingDetail = false;
    this.editPwd = '';
  }

  closeDetail(): void {
    this.selected = null;
  }

  // ---- MOSTRAR / OCULTAR CONTRASEÑA ----
  async toggleShow(entry: PasswordMeta): Promise<void> {
    if (this.showDemo) return;
    const id = entry.id;

    // si ya está visible, la ocultamos
    if (this.revealed[id]) {
      this.revealed[id] = undefined;
      return;
    }

    try {
      // IMPORTANTE: esto tiene que pedir la contraseña desencriptada al main
      const pwd = await this.es.getPassword(id);
      if (pwd) {
        this.revealed[id] = pwd;

        // Si estamos editando este mismo registro y el input esta vacio,
        // rellenamos el campo de edicion con la contraseña real
        if (this.editingDetail && this.selected?.id === id && !this.editPwd) {
          this.editPwd = pwd;
        }
      } else {
        console.warn('[renderer] plaintext not available for id', id);
      }
    } catch (err) {
      console.error('[renderer] getPassword error', err);
    }
  }

  async onRestoreVersion(entry: PasswordMeta): Promise<void> {
    if (this.showDemo) return;
    try {
      const restored = await this.es.restorePasswordVersion(entry.id);
      await this.loadEntries();
      const match = this.entries.find(e => e.id === restored.id);
      if (match) {
        this.selected = match;
        await this.loadHistory(match.id);
      }
      this.master.persistVault(this.entries);
    } catch (err) {
      console.error('[renderer] restore version failed', err);
    }
  }

  async onClearHistory(): Promise<void> {
    if (this.showDemo) return;
    if (!this.selected) return;
    const ok = confirm(this.t('passwords.history.confirmClear'));
    if (!ok) return;
    try {
      await this.es.clearPasswordHistory(this.selected.id);
      await this.loadEntries();
      if (this.selected) {
        await this.loadHistory(this.selected.id);
      }
      this.master.persistVault(this.entries);
    } catch (err) {
      console.error('[renderer] clear history failed', err);
    }
  }

  openHistoryModal(): void {
    if (this.showDemo) return;
    if (!this.history.length) return;
    this.historyModalOpen = true;
  }

  closeHistoryModal(): void {
    this.historyModalOpen = false;
  }

  // ---- ABRIR URL EN NAVEGADOR ----
  async openUrl(url: string, ev?: MouseEvent): Promise<void> {
    if (ev) ev.stopPropagation();
    if (this.showDemo) return;
    if (!url) return;

    try {
      await this.es.openExternal(url);
    } catch (err) {
      console.error('[renderer] open url failed', err);
    }
  }
  
  goToAddPassword(): void {
    if (this.showDemo) return;
    this.router.navigate(['/add']);
  }

  toggleListCollapse(): void {
    this.listCollapsed = !this.listCollapsed;
  }

  onFolderContextMenu(ev: MouseEvent, folder: string): void {
    ev.preventDefault();
    const normalized = this.normalizeFolder(folder);
    this.folderMenu = {
      visible: true,
      x: ev.clientX,
      y: ev.clientY,
      folder: normalized
    };
    this.renamingFolder = null;
    this.renameValue = '';
  }

  closeFolderMenu(): void {
    if (this.folderMenu.visible) {
      this.folderMenu = { visible: false, x: 0, y: 0, folder: '' };
      this.renamingFolder = null;
      this.renameValue = '';
    }
  }

  // --- ORDEN PERSONALIZADO ---
  private normalizeFolder(folder?: string): string {
    const clean = (folder || '').trim();
    const lower = clean.toLowerCase();
    if (!clean || lower === 'sin carpeta' || lower === 'no folder') {
      return this.defaultFolderKey;
    }
    return clean;
  }

  private loadPersistedOrdering(): void {
    try {
      const folders = JSON.parse(localStorage.getItem(this.folderOrderStorageKey) || '[]');
      if (Array.isArray(folders)) {
        this.folderOrder = folders.map((f: any) => this.normalizeFolder(String(f))).filter(Boolean);
      }
    } catch {
      this.folderOrder = [];
    }

    try {
      const items = JSON.parse(localStorage.getItem(this.itemOrderStorageKey) || '{}');
      if (items && typeof items === 'object') {
        const cast: Record<string, string[]> = {};
        for (const [k, v] of Object.entries(items)) {
          if (Array.isArray(v)) {
            cast[this.normalizeFolder(k)] = v.filter(id => typeof id === 'string');
          }
        }
        this.itemOrder = cast;
      }
    } catch {
      this.itemOrder = {};
    }
  }

  private persistOrdering(): void {
    localStorage.setItem(this.folderOrderStorageKey, JSON.stringify(this.folderOrder));
    localStorage.setItem(this.itemOrderStorageKey, JSON.stringify(this.itemOrder));
  }

  private syncOrderingState(): void {
    if (this.showDemo) {
      const folders = this.collectFolders();
      this.folderOrder = folders.sort((a, b) => a.localeCompare(b));
      this.itemOrder = this.mergeItemOrder(folders);
      return;
    }
    if (!this.folderOrder.length && !Object.keys(this.itemOrder).length) {
      this.loadPersistedOrdering();
    }

    const folders = this.collectFolders();
    this.folderOrder = this.mergeFolderOrder(folders);
    this.itemOrder = this.mergeItemOrder(folders);
    this.persistOrdering();
  }

  private collectFolders(): string[] {
    const set = new Set<string>();
    for (const e of this.baseEntries) {
      set.add(this.normalizeFolder(e.folder));
    }
    return Array.from(set);
  }

  private mergeFolderOrder(folders: string[]): string[] {
    const existing = this.folderOrder.filter(f => folders.includes(f));
    const missing = folders.filter(f => !existing.includes(f)).sort((a, b) => a.localeCompare(b));
    return [...existing, ...missing];
  }

  private mergeItemOrder(folders: string[]): Record<string, string[]> {
    const next: Record<string, string[]> = {};
    for (const folder of folders) {
      const currentIds = this.baseEntries
        .filter(e => this.normalizeFolder(e.folder) === folder)
        .map(e => e.id);

      const saved = (this.itemOrder[folder] || []).filter(id => currentIds.includes(id));
      const missing = currentIds.filter(id => !saved.includes(id));
      next[folder] = [...saved, ...missing];
    }
    return next;
  }

  private getOrderedIdsForFolder(folderKey: string): string[] {
    return this.orderedEntries
      .filter(e => this.normalizeFolder(e.folder) === folderKey)
      .map(e => e.id);
  }

  onFolderDragStart(folder: string, ev: DragEvent): void {
    const key = this.normalizeFolder(folder);
    this.draggingFolder = key;
    this.folderDropTarget = null;
    ev.dataTransfer?.setData('text/plain', key);
    ev.dataTransfer?.setDragImage(this.createGhost(this.folderDisplayName(key)), 0, 0);
  }

  onFolderDragEnter(folder: string, ev: DragEvent): void {
    const key = this.normalizeFolder(folder);
    if (this.draggingEntryId && !this.draggingFolder) {
      ev.preventDefault();
      this.folderDropTarget = key;
      return;
    }
    if (!this.draggingFolder || key === this.draggingFolder) return;
    ev.preventDefault();
    this.folderDropTarget = key;
  }

  onFolderDragOver(folder: string, ev: DragEvent): void {
    const key = this.normalizeFolder(folder);
    if (this.draggingEntryId && !this.draggingFolder) {
      ev.preventDefault();
      this.folderDropTarget = key;
      return;
    }
    if (!this.draggingFolder || key === this.draggingFolder) return;
    ev.preventDefault();
    this.folderDropTarget = key;
  }

  async onFolderDrop(folder: string, ev: DragEvent): Promise<void> {
    const key = this.normalizeFolder(folder);
    if (this.draggingEntryId && !this.draggingFolder) {
      ev.preventDefault();
      ev.stopPropagation();
      await this.repositionEntry(this.draggingEntryId, key);
      return;
    }
    if (!this.draggingFolder || key === this.draggingFolder) return;
    ev.preventDefault();
    ev.stopPropagation();
    const from = this.draggingFolder;
    const to = key;
    const list = this.folderOrder.filter(f => f !== from);
    const fromIdx = this.folderOrder.indexOf(from);
    const toIdxOriginal = this.folderOrder.indexOf(to);
    const targetIdx = list.indexOf(to);
    const insertAt = fromIdx !== -1 && toIdxOriginal !== -1 && fromIdx < toIdxOriginal
      ? targetIdx + 1
      : targetIdx;
    list.splice(insertAt < 0 ? list.length : insertAt, 0, from);
    this.folderOrder = list;
    this.folderDropTarget = null;
    this.persistOrdering();
  }

  onFolderDragEnd(): void {
    this.draggingFolder = null;
    this.folderDropTarget = null;
    this.clearGhost();
  }

  onEntryDragStart(entry: PasswordMeta, folder: string, ev: DragEvent): void {
    const folderKey = this.normalizeFolder(folder);
    this.draggingEntryId = entry.id;
    this.draggingEntryFolder = folderKey;
    this.entryDropTarget = null;
    ev.dataTransfer?.setData('text/plain', entry.id);
    ev.dataTransfer?.setDragImage(this.createGhost(entry.label || this.folderDisplayName(folderKey)), 0, 0);
  }

  onEntryDragEnter(entry: PasswordMeta, folder: string, ev: DragEvent): void {
    this.handleEntryDragOver(entry, folder, ev);
  }

  onEntryDragOver(entry: PasswordMeta, folder: string, ev: DragEvent): void {
    this.handleEntryDragOver(entry, folder, ev);
  }

  private handleEntryDragOver(entry: PasswordMeta, folder: string, ev: DragEvent): void {
    if (!this.draggingEntryId || this.draggingFolder) return;
    const folderKey = this.normalizeFolder(folder);
    if (entry.id === this.draggingEntryId) return;
    ev.preventDefault();
    this.entryDropTarget = entry.id;
    this.folderDropTarget = folderKey;
  }

  async onEntryDrop(entry: PasswordMeta, folder: string, ev: DragEvent): Promise<void> {
    if (!this.draggingEntryId || this.draggingFolder) return;
    ev.preventDefault();
    ev.stopPropagation();
    const folderKey = this.normalizeFolder(folder);
    await this.repositionEntry(this.draggingEntryId, folderKey, entry.id);
    this.master.persistVault(this.entries);
  }

  async onEntryDropContainer(folder: string, ev: DragEvent): Promise<void> {
    if (!this.draggingEntryId || this.draggingFolder) return;
    const folderKey = this.normalizeFolder(folder);
    ev.preventDefault();
    ev.stopPropagation();
    await this.repositionEntry(this.draggingEntryId, folderKey);
    this.master.persistVault(this.entries);
  }

  onEntryDragOverContainer(folder: string, ev: DragEvent): void {
    if (!this.draggingEntryId || this.draggingFolder) return;
    ev.preventDefault();
    this.folderDropTarget = this.normalizeFolder(folder);
  }

  onEntryDragEnd(): void {
    this.draggingEntryId = null;
    this.draggingEntryFolder = null;
    this.entryDropTarget = null;
    this.folderDropTarget = null;
    this.clearGhost();
  }

  private async repositionEntry(entryId: string, targetFolder: string, beforeId?: string): Promise<void> {
    const entry = this.entries.find(e => e.id === entryId);
    if (!entry) return;

    const sourceFolder = this.normalizeFolder(entry.folder);
    const destFolder = this.normalizeFolder(targetFolder);
    const storageFolder = destFolder === this.defaultFolderKey ? '' : destFolder;

    const destBaseOrder = this.itemOrder[destFolder] || this.getOrderedIdsForFolder(destFolder);
    const fromIdx = destBaseOrder.indexOf(entryId);

    const sourceList = (this.itemOrder[sourceFolder] || this.getOrderedIdsForFolder(sourceFolder)).filter(id => id !== entryId);
    this.itemOrder[sourceFolder] = sourceList;

    const destListBase = destBaseOrder.filter(id => id !== entryId);
    const targetIdx = typeof beforeId === 'string' ? destListBase.indexOf(beforeId) : -1;
    const targetIdxOriginal = typeof beforeId === 'string' ? destBaseOrder.indexOf(beforeId) : -1;

    const movingDownWithinFolder =
      sourceFolder === destFolder &&
      fromIdx !== -1 &&
      targetIdxOriginal !== -1 &&
      fromIdx < targetIdxOriginal;

    const sourceFolderIdx = this.folderOrder.indexOf(sourceFolder);
    const destFolderIdx = this.folderOrder.indexOf(destFolder);
    const movingDownAcrossFolders =
      sourceFolder !== destFolder &&
      sourceFolderIdx !== -1 &&
      destFolderIdx !== -1 &&
      destFolderIdx > sourceFolderIdx;

    const movingDown = movingDownWithinFolder || movingDownAcrossFolders;

    const insertIdx = targetIdx >= 0
      ? targetIdx + (movingDown ? 1 : 0)
      : destListBase.length;

    destListBase.splice(insertIdx, 0, entryId);
    this.itemOrder[destFolder] = destListBase;

    if (!this.folderOrder.includes(destFolder)) {
      this.folderOrder.push(destFolder);
    }

    this.persistOrdering();

    if (sourceFolder !== destFolder) {
      await this.es.updateMeta(
        entry.id,
        entry.label || '',
        entry.loginUrl || '',
        entry.passwordChangeUrl || '',
        entry.username || '',
        entry.email || '',
        storageFolder,
        !!entry.twoFactorEnabled
      );
    }

    if (sourceFolder !== destFolder) {
      const updatedEntries = this.entries.map(e =>
        e.id === entryId ? { ...e, folder: storageFolder } : e
      );
      this.entries = updatedEntries;
      if (this.selected?.id === entryId) {
        this.selected = updatedEntries.find(e => e.id === entryId) || null;
      }
    }

    this.draggingEntryFolder = destFolder;

    this.folderDropTarget = null;
    this.entryDropTarget = null;
  }

  async deleteFolder(folderLabel: string): Promise<void> {
    if (this.folderActionInProgress) return;
    const folderKey = this.normalizeFolder(folderLabel);
    const groupEntries = this.entries.filter(e => this.normalizeFolder(e.folder) === folderKey);
    if (!groupEntries.length) {
      this.closeFolderMenu();
      return;
    }

    const label = this.folderDisplayName(folderKey);
    const ok = confirm(this.t('passwords.folder.deleteConfirm', { folder: label, target: this.t('passwords.defaultFolder') }));
    if (!ok) {
      this.closeFolderMenu();
      return;
    }

    this.folderActionInProgress = true;
    try {
      for (const e of groupEntries) {
        await this.es.updateMeta(e.id, undefined, undefined, undefined, undefined, undefined, '');
      }

      this.folderOrder = this.folderOrder.filter(f => f !== folderKey);
      delete this.itemOrder[folderKey];
      this.persistOrdering();

      await this.loadEntries();
    } finally {
      this.folderActionInProgress = false;
      this.closeFolderMenu();
    }
  }

  startRename(folderLabel: string): void {
    const key = this.normalizeFolder(folderLabel);
    this.renamingFolder = key;
    this.renameValue = key === this.defaultFolderKey ? '' : folderLabel;
  }

  cancelRename(): void {
    this.renamingFolder = null;
    this.renameValue = '';
  }

  async confirmRename(): Promise<void> {
    if (!this.renamingFolder) return;
    await this.renameFolderWithName(this.renamingFolder, this.renameValue);
  }

  private async renameFolderWithName(folderLabel: string, newName: string): Promise<void> {
    if (this.folderActionInProgress) return;
    const folderKey = this.normalizeFolder(folderLabel);
    const groupEntries = this.entries.filter(e => this.normalizeFolder(e.folder) === folderKey);
    if (!groupEntries.length) {
      this.closeFolderMenu();
      return;
    }

    const trimmed = (newName || '').trim();
    if (!trimmed) {
      alert(this.t('passwords.folder.renameEmpty'));
      return;
    }

    const newKey = this.normalizeFolder(trimmed);
    if (newKey === folderKey) {
      this.closeFolderMenu();
      return;
    }

    this.folderActionInProgress = true;
    try {
      // Serial para evitar escrituras concurrentes en el vault
      for (const e of groupEntries) {
        await this.es.updateMeta(e.id, undefined, undefined, undefined, undefined, undefined, trimmed);
      }

      const existingOrder = this.folderOrder.filter(f => f !== folderKey);
      const targetIdx = this.folderOrder.indexOf(folderKey);
      const withoutDupes = existingOrder.filter(f => f !== newKey);
      if (targetIdx >= 0) {
        withoutDupes.splice(Math.min(targetIdx, withoutDupes.length), 0, newKey);
      } else if (!withoutDupes.includes(newKey)) {
        withoutDupes.push(newKey);
      }
      this.folderOrder = withoutDupes;

      const movedItems = this.itemOrder[folderKey] || groupEntries.map(e => e.id);
      const existingNewList = this.itemOrder[newKey] || [];
      const merged = [...existingNewList, ...movedItems.filter(id => !existingNewList.includes(id))];
      if (merged.length) {
        this.itemOrder[newKey] = merged;
      }
      delete this.itemOrder[folderKey];

      this.persistOrdering();

      // actualizar estado local sin recargar desde disco
      const updatedEntries = this.entries.map(e =>
        this.normalizeFolder(e.folder) === folderKey ? { ...e, folder: trimmed } : e
      );
      this.entries = updatedEntries;
      if (this.selected?.id) {
        this.selected = updatedEntries.find(e => e.id === this.selected!.id) || null;
      }
      this.master.persistVault(this.entries);
    } finally {
      this.folderActionInProgress = false;
      this.closeFolderMenu();
    }
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.closeFolderMenu();
  }

@HostListener('document:keydown.escape', ['$event'])
  onEsc(ev: KeyboardEvent | Event): void {
    (ev as KeyboardEvent).stopPropagation?.();
    this.closeFolderMenu();
  }

  @HostListener('document:kp-toggle-filters', ['$event'])
  onToggleFilters(ev: Event): void {
    const open = (ev as CustomEvent<{ open?: boolean }>).detail?.open;
    if (typeof open === 'boolean') {
      this.filtersCollapsed = !open;
    } else {
      this.filtersCollapsed = !this.filtersCollapsed;
    }
  }

  @HostListener('document:kp-demo-disable')
  onDemoDisable(): void {
    if (!this.showDemo) return;
    this.showDemo = false;
    this.selected = null;
    this.history = [];
    this.historyModalOpen = false;
  }

  @HostListener('document:kp-demo-enable')
  async onDemoEnable(): Promise<void> {
    if (this.entries.length > 0) return;
    this.showDemo = true;
    this.selected = this.demoEntries[0] || null;
    this.history = [];
    this.historyModalOpen = false;
    this.cdr.markForCheck();
  }

  @HostListener('document:kp-select-first-password')
  async onSelectFirstPassword(): Promise<void> {
    if (this.showDemo) {
      this.selected = this.demoEntries[0] || null;
      return;
    }
    if (!this.entries.length) return;
    this.selected = this.entries[0];
    await this.loadHistory(this.selected.id);
    this.cdr.markForCheck();
  }

  private createGhost(text: string): HTMLElement {
    if (this.dragGhostEl) {
      this.dragGhostEl.remove();
    }
    const ghost = document.createElement('div');
    ghost.textContent = text;
    ghost.style.position = 'fixed';
    ghost.style.top = '-9999px';
    ghost.style.left = '-9999px';
    ghost.style.padding = '8px 10px';
    ghost.style.borderRadius = '10px';
    ghost.style.background = '#1f2937';
    ghost.style.color = '#e5e7eb';
    ghost.style.fontSize = '12px';
    ghost.style.fontWeight = '600';
    document.body.appendChild(ghost);
    this.dragGhostEl = ghost;
    return ghost;
  }

  private clearGhost(): void {
    if (this.dragGhostEl) {
      this.dragGhostEl.remove();
      this.dragGhostEl = null;
    }
  }

  private t(key: string, params?: Record<string, string | number>): string {
    return this.i18n.translate(key, params);
  }

  private get baseEntries(): PasswordMeta[] {
    return this.showDemo ? this.demoEntries : this.entries;
  }

  get viewEntries(): PasswordMeta[] {
    return this.baseEntries;
  }

  iconImageSrc(entry: PasswordMeta): string | null {
    const iconName = entry.iconName || resolveEntryIcon(entry).iconName;
    const normalized = iconName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const candidates = [
      SERVICE_ICON_ASSETS[iconName],
      `assets/icons/services/${iconName}.svg`,
      `assets/icons/services/${normalized}.svg`,
      `assets/icons/services/${iconName}.png`,
      `assets/icons/services/${normalized}.png`
    ].filter((v): v is string => !!v);

    for (const src of candidates) {
      if (!this.brokenIconAssets.has(src)) {
        return src;
      }
    }
    return null;
  }

  onIconImageError(src: string | null): void {
    if (!src) return;
    this.brokenIconAssets.add(src);
  }

  iconFallbackText(entry: PasswordMeta): string {
    const raw = (entry.label || '').trim();
    if (!raw) return '?';
    const parts = raw
      .split(/[^\p{L}\p{N}]+/u)
      .map(p => p.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  }

  private buildDemoEntries(): PasswordMeta[] {
    const now = Date.now();
    const mk = (id: string, label: string, folder: string, email?: string, username?: string, loginUrl?: string, twoFactorEnabled?: boolean, length = 16, classMask = 15): PasswordMeta => ({
      id,
      label,
      folder,
      email,
      username,
      loginUrl,
      twoFactorEnabled,
      createdAt: now - 86_400_000,
      updatedAt: now - 43_200_000,
      length,
      classMask
    });
    return [
      mk('demo-1', 'Gmail', 'Personal', 'alex@example.com', undefined, 'https://mail.google.com', true, 18),
      mk('demo-2', 'Banco Online', 'Finanzas', undefined, 'abperez', 'https://banco.example.com', true, 20),
      mk('demo-3', 'GitHub', 'Trabajo', 'dev@example.com', 'devuser', 'https://github.com', false, 24),
      mk('demo-4', 'Netflix', 'Personal', 'cine@example.com', undefined, 'https://netflix.com', false, 14)
    ];
  }

  private getDemoHistory(entry: PasswordMeta | null): PasswordMeta[] {
    if (!entry) return [];
    const baseTs = entry.createdAt || Date.now();
    return [
      {
        ...entry,
        id: `${entry.id}-h1`,
        updatedAt: baseTs + 60_000,
        createdAt: baseTs,
        length: entry.length - 2,
        classMask: entry.classMask,
        active: false
      },
      {
        ...entry,
        id: `${entry.id}-h2`,
        updatedAt: baseTs + 120_000,
        createdAt: baseTs + 60_000,
        length: entry.length,
        classMask: entry.classMask,
        active: true
      }
    ];
  }

  private resolveIconMetaForEdit(): { iconName?: string; iconSource?: 'auto' | 'manual'; detectedService?: string } {
    if (!this.selected) return {};
    if (this.selected.iconSource === 'manual' && this.selected.iconName) {
      return {
        iconName: this.selected.iconName,
        iconSource: 'manual',
        detectedService: this.selected.detectedService
      };
    }

    const resolved = resolveEntryIcon({
      label: this.editLabel,
      loginUrl: this.editLoginUrl,
      passwordChangeUrl: this.editPasswordChangeUrl,
      username: this.editUsername,
      email: this.editEmail
    });

    return {
      iconName: resolved.iconName,
      iconSource: 'auto',
      detectedService: resolved.serviceId
    };
  }

  private isDemoAllowed(): boolean {
    return localStorage.getItem('keyping.demo.disabled') !== '1';
  }
}
