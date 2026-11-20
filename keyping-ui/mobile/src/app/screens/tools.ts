// Pestañas Generador y Ajustes, y las pantallas de exportar, importar y cambiar la contraseña maestra.
import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { I18n, Lang } from '../i18n';
import { AUTOLOCK_OPTIONS, Entry, VaultStore } from '../vault';
import { Confirm, Icon, Nav, Toast } from '../ui';
import { platform } from '../platform/mobile-bridge';
import { serializeMasterExport } from '../../../../core/export-format';
import { generatePassword } from '../../../../core/password-generator';
import { PasswordField, loadGenOptions } from './password-field';
import pkg from '../../../../package.json';

@Component({
  selector: 'kp-generator',
  standalone: true,
  imports: [Icon, PasswordField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <header class="appbar large"><div class="appbar-row"><h1>{{ i18n.t('gen.title') }}</h1></div></header>
  <main class="page">
    <kp-password-field [(value)]="password" [autoGenerate]="true"/>
    <button class="btn primary big" (click)="saveAs()" [disabled]="!password()"><kp-icon name="plus"/>{{ i18n.t('gen.saveAs') }}</button>
  </main>`
})
export class GeneratorScreen implements OnDestroy {
  readonly i18n = inject(I18n);
  private readonly nav = inject(Nav);
  readonly password = signal(generatePassword(loadGenOptions()));

  ngOnDestroy(): void {
    this.password.set('');
  }

  saveAs(): void {
    this.nav.push({ name: 'edit', password: this.password() });
  }
}

@Component({
  selector: 'kp-settings',
  standalone: true,
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <header class="appbar large"><div class="appbar-row"><h1>{{ i18n.t('tab.settings') }}</h1></div></header>
  <main class="page">
    <h2 class="section">{{ i18n.t('set.transfer') }}</h2>
    <p class="muted small">{{ i18n.t('set.transferLead') }}</p>
    <div class="list-card">
      <button class="item" (click)="nav.push({ name: 'export' })"><kp-icon name="download"/><span>{{ i18n.t('set.export') }}</span><kp-icon name="chevron" [size]="20"/></button>
      <button class="item" (click)="nav.push({ name: 'import' })"><kp-icon name="upload"/><span>{{ i18n.t('set.import') }}</span><kp-icon name="chevron" [size]="20"/></button>
    </div>

    <h2 class="section">{{ i18n.t('set.security') }}</h2>
    <div class="list-card">
      <button class="item" (click)="store.lock()"><kp-icon name="lock"/><span>{{ i18n.t('set.lockNow') }}</span></button>
      <div class="item static">
        <kp-icon name="history"/><span>{{ i18n.t('set.autoLock') }}</span>
        <div class="segmented">
          @for (m of autoLockOptions; track m) {
            <button [class.on]="store.autoLockMin() === m" (click)="store.setAutoLock(m)">{{ i18n.t('set.minutes', { n: m }) }}</button>
          }
        </div>
      </div>
      <button class="item" (click)="nav.push({ name: 'master' })"><kp-icon name="key"/><span>{{ i18n.t('set.changeMaster') }}</span><kp-icon name="chevron" [size]="20"/></button>
      <div class="item static">
        <kp-icon name="copy"/><span>{{ i18n.t('set.history') }}</span>
        <div class="segmented">
          @for (n of historyOptions; track n) {
            <button [class.on]="maxHistory() === n" (click)="setHistory(n)">{{ n }}</button>
          }
        </div>
      </div>
    </div>

    <h2 class="section">{{ i18n.t('set.language') }}</h2>
    <div class="segmented wide">
      <button [class.on]="i18n.lang() === 'es'" (click)="setLang('es')" lang="es">Español</button>
      <button [class.on]="i18n.lang() === 'en'" (click)="setLang('en')" lang="en">English</button>
    </div>

    <h2 class="section">{{ i18n.t('set.about') }}</h2>
    <p class="muted small">{{ i18n.t('set.aboutText', { v: version }) }}</p>
  </main>`
})
export class SettingsScreen {
  readonly i18n = inject(I18n);
  readonly nav = inject(Nav);
  readonly store = inject(VaultStore);
  private readonly toast = inject(Toast);
  readonly autoLockOptions = AUTOLOCK_OPTIONS;
  readonly historyOptions = [5, 10, 20];
  readonly maxHistory = signal(10);
  readonly version = pkg.version;

  constructor() {
    void this.store.svc.getHistorySettings().then(s => this.maxHistory.set(s.maxHistoryPerEntry)).catch(() => {});
  }

  setLang(l: Lang): void {
    this.i18n.setLang(l);
  }

  async setHistory(n: number): Promise<void> {
    const s = await this.store.svc.updateHistorySettings(n);
    this.maxHistory.set(s?.maxHistoryPerEntry ?? n);
    this.toast.show(this.i18n.t('set.saved'));
  }
}

@Component({
  selector: 'kp-export',
  standalone: true,
  imports: [FormsModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <header class="appbar">
    <button class="icon-btn" (click)="nav.back()" [attr.aria-label]="i18n.t('common.back')"><kp-icon name="back"/></button>
    <h1 class="appbar-title">{{ i18n.t('exp.title') }}</h1><span class="icon-btn-space"></span>
  </header>
  <main class="page stack">
    <p>{{ i18n.t('exp.lead') }}</p>
    @if (!file()) {
      <form class="stack" (ngSubmit)="create()">
        <p class="muted small">{{ i18n.t('exp.passwordLead') }}</p>
        <label class="field">
          <span>{{ i18n.t('exp.password') }}</span>
          <input id="export-pwd" type="password" name="pwd" [(ngModel)]="pwd" autocomplete="current-password" autocapitalize="off" spellcheck="false">
        </label>
        <label class="toggle row-toggle"><input id="export-history" type="checkbox" name="history" [(ngModel)]="history">{{ i18n.t('exp.history') }}</label>
        @if (error()) { <p class="msg error" role="alert">{{ error() }}</p> }
        <button class="btn primary big" type="submit" [disabled]="busy() || !pwd">
          {{ busy() ? i18n.t('common.working') : i18n.t('exp.create') }}</button>
      </form>
    } @else {
      <p class="msg ok">{{ i18n.t('exp.ready', { name: file()!.name }) }}</p>
      <button class="btn primary big" (click)="deliver('save')"><kp-icon name="download"/>{{ i18n.t('exp.save') }}</button>
      <button class="btn big" (click)="deliver('share')"><kp-icon name="share"/>{{ i18n.t('exp.share') }}</button>
      <p class="muted small">{{ i18n.t('exp.warn') }}</p>
    }
  </main>`
})
export class ExportScreen implements OnDestroy {
  readonly i18n = inject(I18n);
  readonly nav = inject(Nav);
  private readonly store = inject(VaultStore);
  private readonly toast = inject(Toast);
  pwd = '';
  history = true;
  readonly busy = signal(false);
  readonly error = signal('');
  readonly file = signal<{ name: string; text: string } | null>(null);

  ngOnDestroy(): void {
    this.pwd = '';
    this.file.set(null);
  }

  async create(): Promise<void> {
    if (!this.pwd || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      // Igual que el escritorio: la exportación portable se protege con la contraseña maestra.
      if (!(await this.store.svc.authVerify(this.pwd))) {
        this.error.set(this.i18n.t('exp.wrong'));
        return;
      }
      const res = (await this.store.svc.exportVault('master', this.pwd, this.history)) as any;
      this.file.set({ name: res.filename, text: serializeMasterExport(res.payload) });
    } catch {
      this.error.set(this.i18n.t('common.error'));
    } finally {
      this.pwd = '';
      this.busy.set(false);
    }
  }

  async deliver(how: 'save' | 'share'): Promise<void> {
    const f = this.file();
    if (!f) return;
    const p = platform();
    const ok = await p.withSystemUi(() => p.extras.saveExportFile(f.name, f.text, how)).catch(() => false);
    if (how === 'save') this.toast.show(this.i18n.t(ok ? 'exp.saved' : 'exp.notSaved'));
  }
}

type Reason = 'new' | 'existing' | 'conflict';
type Item = { idx: number; label: string; sub: string; reason: Reason; selected: boolean };

@Component({
  selector: 'kp-import',
  standalone: true,
  imports: [FormsModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <header class="appbar">
    <button class="icon-btn" (click)="nav.back()" [attr.aria-label]="i18n.t('common.back')"><kp-icon name="back"/></button>
    <h1 class="appbar-title">{{ i18n.t('imp.title') }}</h1><span class="icon-btn-space"></span>
  </header>
  <main class="page stack">
    @switch (step()) {
      @case ('pick') {
        <p>{{ i18n.t('imp.lead') }}</p>
        <button class="btn primary big" (click)="pick()" [disabled]="busy()"><kp-icon name="upload"/>{{ i18n.t('imp.pick') }}</button>
      }
      @case ('password') {
        <p class="file-name">{{ fileName() }}</p>
        <form class="stack" (ngSubmit)="open()">
          <label class="field">
            <span>{{ i18n.t('imp.password') }}</span>
            <input id="import-pwd" type="password" name="pwd" [(ngModel)]="pwd" autocomplete="off" autocapitalize="off" spellcheck="false">
          </label>
          <p class="muted small">{{ i18n.t('imp.passwordLead') }}</p>
          <button class="btn primary big" type="submit" [disabled]="busy() || !pwd">
            {{ busy() ? i18n.t('common.working') : i18n.t('imp.open') }}</button>
        </form>
      }
      @case ('review') {
        <p class="file-name">{{ fileName() }}</p>
        <p><strong>{{ i18n.t('imp.found', { n: items().length }) }}</strong></p>
        <div class="segmented">
          <button (click)="selectAll(true)">{{ i18n.t('imp.selectAll') }}</button>
          <button (click)="selectAll(false)">{{ i18n.t('imp.selectNone') }}</button>
        </div>
        <ul class="rows checks">
          @for (it of items(); track it.idx) {
            <li><label class="row">
              <input type="checkbox" [checked]="it.selected" (change)="toggle(it)">
              <span class="row-text">
                <span class="row-title">{{ it.label }}</span>
                <span class="row-sub">{{ it.sub }}{{ it.sub ? ' · ' : '' }}<span [class]="'reason ' + it.reason">{{ i18n.t('imp.reason.' + it.reason) }}</span></span>
              </span>
            </label></li>
          }
        </ul>
        @if (canAdopt()) {
          <label class="toggle row-toggle"><input id="import-adopt" type="checkbox" [checked]="adopt()" (change)="adopt.set(!adopt())">{{ i18n.t('imp.adopt') }}</label>
          @if (adopt()) {
            <label class="field">
              <span>{{ i18n.t('imp.adoptCurrent') }}</span>
              <input id="import-current" type="password" name="current" [(ngModel)]="current" autocomplete="current-password" autocapitalize="off" spellcheck="false">
            </label>
            <p class="muted small">{{ i18n.t('imp.adoptHint') }}</p>
          }
        } @else {
          <p class="muted small">{{ i18n.t('imp.keepMaster') }}</p>
        }
        <button class="btn primary big" (click)="run('merge')" [disabled]="busy() || !selectedCount() || (adopt() && canAdopt() && !current)">
          {{ i18n.t('imp.merge', { n: selectedCount() }) }}</button>
        <button class="btn ghost-danger" (click)="run('overwrite')" [disabled]="busy() || (adopt() && canAdopt() && !current)">{{ i18n.t('imp.overwrite') }}</button>
      }
    }
    @if (error()) { <p class="msg error" role="alert">{{ error() }}</p> }
  </main>`
})
export class ImportScreen implements OnDestroy {
  readonly i18n = inject(I18n);
  readonly nav = inject(Nav);
  private readonly store = inject(VaultStore);
  private readonly toast = inject(Toast);
  private readonly confirm = inject(Confirm);
  readonly step = signal<'pick' | 'password' | 'review'>('pick');
  readonly busy = signal(false);
  readonly error = signal('');
  readonly fileName = signal('');
  readonly items = signal<Item[]>([]);
  readonly selectedCount = computed(() => this.items().filter(i => i.selected).length);
  /** El archivo se abrió con una contraseña que puede ser maestra (8 caracteres o más). */
  readonly canAdopt = signal(false);
  readonly adopt = signal(true);
  pwd = '';
  current = '';
  private filePassword = '';
  private raw = '';

  ngOnDestroy(): void {
    this.raw = this.pwd = this.current = this.filePassword = '';
  }

  async pick(): Promise<void> {
    this.error.set('');
    const p = platform();
    // El selector del sistema deja la app en segundo plano: no se bloquea mientras está abierto.
    const r = await p.withSystemUi(() => p.extras.pickImportFile()).catch(() => ({ error: 'read-error' as const }));
    if (!r) return;
    if ('error' in r) return this.error.set(this.i18n.t(r.error === 'too-large' ? 'imp.err.tooLarge' : 'imp.err.invalid'));
    this.raw = r.text;
    this.fileName.set(r.name);
    await this.parse();
  }

  async open(): Promise<void> {
    if (!this.pwd) return;
    await this.parse(this.pwd);
  }

  private async parse(password?: string): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const res = (await this.store.svc.parseImport(this.raw, password)) as any;
      if (res.requiresPassword) {
        this.step.set('password');
        return;
      }
      this.filePassword = password ?? '';
      this.pwd = '';
      // No se compara con la maestra actual: authVerify contaría un intento fallido.
      this.canAdopt.set(this.filePassword.length >= 8);
      this.items.set(this.preview(res.entries || []));
      this.step.set('review');
    } catch (err) {
      this.error.set(this.i18n.t(errorKey(err)));
    } finally {
      this.busy.set(false);
    }
  }

  // Igual que el escritorio: las versiones antiguas viajan con su entrada y no se listan sueltas.
  private preview(entries: any[]): Item[] {
    const current = new Map<string, Entry>(this.store.entries().map(e => [e.id, e]));
    const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();
    const items: Item[] = [];
    entries.forEach((raw, idx) => {
      if (raw?.active === false) return;
      const label = raw?.label || raw?.name || raw?.title || raw?.username || raw?.email || this.i18n.t('list.noName');
      let reason: Reason = 'new';
      const cur = raw?.id ? current.get(raw.id) : undefined;
      if (cur) {
        const same = norm(raw.label) === norm(cur.label) && norm(raw.username) === norm(cur.username)
          && norm(raw.email) === norm(cur.email) && norm(raw.loginUrl) === norm(cur.loginUrl);
        reason = same ? 'existing' : 'conflict';
      }
      items.push({ idx, label, sub: raw?.username || raw?.email || '', reason, selected: reason !== 'existing' });
    });
    return items;
  }

  toggle(it: Item): void {
    this.items.update(list => list.map(i => (i.idx === it.idx ? { ...i, selected: !i.selected } : i)));
  }

  selectAll(v: boolean): void {
    this.items.update(list => list.map(i => ({ ...i, selected: v })));
  }

  async run(mode: 'merge' | 'overwrite'): Promise<void> {
    if (mode === 'overwrite' && !(await this.confirm.ask(this.i18n.t('imp.overwriteConfirm'), this.i18n.t('imp.overwrite')))) return;
    const adopt = this.canAdopt() && this.adopt();
    this.busy.set(true);
    this.error.set('');
    try {
      // La contraseña actual se comprueba antes de importar para no dejar el cambio a medias.
      if (adopt && !(await this.store.svc.authVerify(this.current))) {
        this.error.set(this.i18n.t('master.wrong'));
        return;
      }
      const selection = this.items().filter(i => i.selected).map(i => ({
        idx: i.idx,
        label: i.reason === 'conflict' ? `${i.label} - ${this.i18n.t('imp.conflictSuffix')}`
          : i.reason === 'existing' ? `${i.label} - ${this.i18n.t('imp.duplicateSuffix')}` : i.label
      }));
      const res = (await this.store.svc.importVault(mode, mode === 'merge' ? selection : undefined)) as any;
      this.raw = '';
      let adopted = false;
      if (adopt) adopted = (await this.store.svc.authChange(this.current, this.filePassword)).ok;
      this.current = this.filePassword = '';
      await this.store.refresh();
      this.toast.show(this.i18n.t(adopted ? 'imp.adoptDone' : 'imp.done', { n: res.imported }), 4000);
      this.nav.reset();
    } catch (err) {
      this.error.set(this.i18n.t(errorKey(err)));
      if (String((err as any)?.message).includes('import-expired')) this.step.set('pick');
    } finally {
      this.busy.set(false);
    }
  }
}

function errorKey(err: unknown): string {
  const msg = String((err as any)?.message || '');
  if (msg.includes('import-wrong-password')) return 'imp.err.wrongPassword';
  if (msg.includes('import-native-key-mismatch')) return 'imp.err.native';
  if (msg.includes('import-too-large')) return 'imp.err.tooLarge';
  if (msg.includes('import-expired')) return 'imp.err.expired';
  if (msg.includes('invalid-import-file')) return 'imp.err.invalid';
  return 'common.error';
}

@Component({
  selector: 'kp-master',
  standalone: true,
  imports: [FormsModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <header class="appbar">
    <button class="icon-btn" (click)="nav.back()" [attr.aria-label]="i18n.t('common.back')"><kp-icon name="back"/></button>
    <h1 class="appbar-title">{{ i18n.t('master.title') }}</h1><span class="icon-btn-space"></span>
  </header>
  <form class="page stack" (ngSubmit)="change()">
    <label class="field"><span>{{ i18n.t('master.current') }}</span>
      <input id="master-current" type="password" name="cur" [(ngModel)]="cur" autocomplete="current-password" autocapitalize="off"></label>
    <label class="field"><span>{{ i18n.t('master.next') }}</span>
      <input id="master-next" type="password" name="next" [(ngModel)]="next" autocomplete="new-password" autocapitalize="off"></label>
    <label class="field"><span>{{ i18n.t('master.confirm') }}</span>
      <input id="master-confirm" type="password" name="confirm" [(ngModel)]="confirm" autocomplete="new-password" autocapitalize="off"></label>
    <p class="hint">{{ i18n.t('setup.min') }}</p>
    @if (error()) { <p class="msg error" role="alert">{{ error() }}</p> }
    <button class="btn primary big" type="submit" [disabled]="busy() || !cur || next.length < 8 || !confirm">
      {{ busy() ? i18n.t('setup.creating') : i18n.t('common.save') }}</button>
  </form>`
})
export class MasterScreen implements OnDestroy {
  readonly i18n = inject(I18n);
  readonly nav = inject(Nav);
  private readonly store = inject(VaultStore);
  private readonly toast = inject(Toast);
  cur = '';
  next = '';
  confirm = '';
  readonly busy = signal(false);
  readonly error = signal('');

  ngOnDestroy(): void {
    this.cur = this.next = this.confirm = '';
  }

  async change(): Promise<void> {
    if (this.next !== this.confirm) return this.error.set(this.i18n.t('setup.mismatch'));
    this.busy.set(true);
    this.error.set('');
    try {
      const r = await this.store.svc.authChange(this.cur, this.next);
      if (r.ok) {
        this.toast.show(this.i18n.t('master.done'));
        this.nav.back();
      } else if (r.reason === 'cooldown') {
        this.error.set(this.i18n.t('unlock.cooldown', { s: Math.ceil((r.remainingMs ?? 0) / 1000) }));
      } else {
        this.error.set(this.i18n.t(r.reason === 'invalid' ? 'master.wrong' : 'common.error'));
      }
    } finally {
      this.cur = '';
      this.busy.set(false);
    }
  }
}
