// Detalle de una entrada y flujo de urgencia: «Cambiar contraseña» → generar → guardar, copiar y abrir la web.
import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { I18n } from '../i18n';
import { Entry, VaultStore, displayName, hostOf } from '../vault';
import { Confirm, Icon, Nav, Toast, avatarOf } from '../ui';
import { PasswordField } from './password-field';

const REVEAL_MS = 30_000;

@Component({
  selector: 'kp-detail',
  standalone: true,
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  @if (entry(); as e) {
    <header class="appbar">
      <button class="icon-btn" (click)="nav.back()" [attr.aria-label]="i18n.t('common.back')"><kp-icon name="back"/></button>
      <h1 class="appbar-title">{{ name() }}</h1>
      <button class="icon-btn" (click)="nav.push({ name: 'edit', id: e.id })" [attr.aria-label]="i18n.t('common.edit')"><kp-icon name="edit"/></button>
    </header>
    <main class="page">
      <div class="hero">
        <span class="avatar big" [style.--h]="avatar().hue">{{ avatar().letter }}</span>
        <div>
          <h2>{{ name() }}</h2>
          @if (e.folder) { <span class="tag">{{ e.folder }}</span> }
        </div>
      </div>

      <section class="card">
        <div class="card-label">{{ i18n.t('detail.password') }}</div>
        <div class="secret" [class.revealed]="plain() !== null">{{ plain() ?? dots() }}</div>
        <div class="btn-pair">
          <button class="btn" (click)="toggleReveal()"><kp-icon [name]="plain() !== null ? 'eyeOff' : 'eye'"/>
            {{ i18n.t(plain() !== null ? 'common.hide' : 'common.show') }}</button>
          <button class="btn primary" (click)="copyPassword()"><kp-icon name="copy"/>{{ i18n.t('common.copy') }}</button>
        </div>
      </section>

      @if (e.username) {
        <button class="card line" (click)="copy(e.username)">
          <span><span class="card-label">{{ i18n.t('detail.username') }}</span><span class="value">{{ e.username }}</span></span>
          <kp-icon name="copy"/>
        </button>
      }
      @if (e.email) {
        <button class="card line" (click)="copy(e.email)">
          <span><span class="card-label">{{ i18n.t('detail.email') }}</span><span class="value">{{ e.email }}</span></span>
          <kp-icon name="copy"/>
        </button>
      }
      @if (e.loginUrl) {
        <button class="card line" (click)="openUrl(e.loginUrl)">
          <span><span class="card-label">{{ i18n.t('detail.openSite') }}</span><span class="value">{{ host(e.loginUrl) }}</span></span>
          <kp-icon name="external"/>
        </button>
      }
      @if (e.twoFactorEnabled) { <p class="badge"><kp-icon name="shield" [size]="18"/>{{ i18n.t('detail.twoFactor') }}</p> }

      <section class="urgent">
        <button class="btn danger-soft big" (click)="nav.push({ name: 'newpwd', id: e.id })">
          <kp-icon name="refresh"/>{{ i18n.t(changeUrl() ? 'detail.change' : 'detail.newPassword') }}</button>
        @if (changeUrl()) { <p class="hint">{{ i18n.t('detail.changeHint') }}</p> }
      </section>

      <details class="card history" (toggle)="onHistory($any($event.target).open)">
        <summary><kp-icon name="history"/>{{ i18n.t('detail.history', { n: previous().length }) }}</summary>
        @for (v of previous(); track v.id) {
          <div class="version">
            <span>{{ i18n.date(v.updatedAt || v.createdAt) }} · {{ i18n.t('detail.chars', { n: v.length }) }}</span>
            <span class="version-actions">
              <button class="btn small" (click)="restore(v)">{{ i18n.t('detail.restore') }}</button>
              <button class="icon-btn" (click)="removeVersion(v)" [attr.aria-label]="i18n.t('common.delete')"><kp-icon name="trash" [size]="20"/></button>
            </span>
          </div>
        } @empty {
          <p class="muted">{{ i18n.t('detail.historyEmpty') }}</p>
        }
      </details>

      <p class="meta muted">
        {{ i18n.t('detail.updated', { d: i18n.date(e.updatedAt || e.createdAt) }) }}
      </p>
      <button class="btn ghost-danger" (click)="remove()"><kp-icon name="trash"/>{{ i18n.t('common.delete') }}</button>
    </main>
  }`
})
export class DetailScreen implements OnDestroy {
  readonly i18n = inject(I18n);
  readonly nav = inject(Nav);
  private readonly store = inject(VaultStore);
  private readonly toast = inject(Toast);
  private readonly confirm = inject(Confirm);

  readonly id = input.required<string>();
  readonly entry = computed(() => this.store.byId(this.id()));
  readonly name = computed(() => (this.entry() ? displayName(this.entry()!) : '') || this.i18n.t('list.noName'));
  readonly avatar = computed(() => avatarOf(this.name()));
  readonly dots = computed(() => '•'.repeat(Math.min(16, this.entry()?.length || 12)));
  readonly changeUrl = computed(() => this.entry()?.passwordChangeUrl || this.entry()?.loginUrl || '');
  readonly plain = signal<string | null>(null);
  readonly previous = signal<Entry[]>([]);
  private hideTimer?: ReturnType<typeof setTimeout>;
  private historyOpen = false;

  constructor() {
    // Si la entrada cambia (nueva versión, otra entrada) se oculta la contraseña mostrada.
    effect(() => {
      this.id();
      untracked(() => {
        this.hide();
        if (this.historyOpen) void this.loadHistory();
      });
    });
    this.store.onLock(() => this.hide());
  }

  ngOnDestroy(): void {
    this.hide();
  }

  host(url: string): string {
    return hostOf(url) || url;
  }

  async toggleReveal(): Promise<void> {
    if (this.plain() !== null) return this.hide();
    const pwd = await this.store.svc.getPassword(this.id());
    if (typeof pwd !== 'string') return;
    this.plain.set(pwd);
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.hide(), REVEAL_MS);
  }

  hide(): void {
    clearTimeout(this.hideTimer);
    this.plain.set(null);
  }

  async copyPassword(): Promise<void> {
    const ok = await this.store.svc.copyPassword(this.id());
    this.toast.show(this.i18n.t(ok ? 'copy.done' : 'copy.fail'));
  }

  async copy(text: string): Promise<void> {
    const ok = await this.store.svc.copyText(text);
    this.toast.show(this.i18n.t(ok ? 'copy.done' : 'copy.fail'));
  }

  async openUrl(url: string): Promise<void> {
    if (!(await this.store.svc.openExternal(url))) this.toast.show(this.i18n.t('detail.openFailed'));
  }

  onHistory(open: boolean): void {
    this.historyOpen = open;
    if (open) void this.loadHistory();
  }

  private async loadHistory(): Promise<void> {
    const chain = (await this.store.svc.getPasswordHistory(this.id())) as Entry[];
    this.previous.set(chain.filter(v => v.active === false));
  }

  async restore(v: Entry): Promise<void> {
    const restored = (await this.store.svc.restorePasswordVersion(v.id)) as Entry;
    await this.store.refresh();
    this.toast.show(this.i18n.t('detail.restored'));
    this.nav.replace({ name: 'detail', id: restored.id });
  }

  async removeVersion(v: Entry): Promise<void> {
    if (!(await this.confirm.ask(this.i18n.t('detail.versionDeleteConfirm'), this.i18n.t('common.delete')))) return;
    await this.store.svc.deletePasswordVersion(v.id);
    await this.loadHistory();
  }

  async remove(): Promise<void> {
    if (!(await this.confirm.ask(this.i18n.t('detail.deleteConfirm', { name: this.name() }), this.i18n.t('common.delete')))) return;
    await this.store.remove(this.id());
    this.toast.show(this.i18n.t('detail.deleted'));
    this.nav.back();
  }
}

/** Contraseña nueva para una entrada existente: se guarda antes de abrir la web para no perderla nunca. */
@Component({
  selector: 'kp-newpwd',
  standalone: true,
  imports: [Icon, PasswordField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <header class="appbar">
    <button class="icon-btn" (click)="nav.back()" [attr.aria-label]="i18n.t('common.back')"><kp-icon name="back"/></button>
    <h1 class="appbar-title">{{ i18n.t('newpwd.title') }}</h1>
    <span class="icon-btn-space"></span>
  </header>
  <main class="page">
    <p class="lead">{{ name() }}</p>
    <p class="muted">{{ i18n.t(changeUrl() ? 'newpwd.lead' : 'newpwd.leadNoUrl') }}</p>
    <kp-password-field [(value)]="password" [autoGenerate]="true"/>
    @if (error()) { <p class="msg error" role="alert">{{ error() }}</p> }
    <div class="actions">
      @if (changeUrl()) {
        <button class="btn primary big" (click)="save(true)" [disabled]="busy() || !password()">
          <kp-icon name="external"/>{{ i18n.t('newpwd.saveOpen') }}</button>
        <button class="btn" (click)="save(false)" [disabled]="busy() || !password()">{{ i18n.t('newpwd.saveOnly') }}</button>
      } @else {
        <button class="btn primary big" (click)="save(false)" [disabled]="busy() || !password()">
          <kp-icon name="check"/>{{ i18n.t('common.save') }}</button>
      }
    </div>
  </main>`
})
export class NewPasswordScreen {
  readonly i18n = inject(I18n);
  readonly nav = inject(Nav);
  private readonly store = inject(VaultStore);
  private readonly toast = inject(Toast);

  readonly id = input.required<string>();
  readonly entry = computed(() => this.store.byId(this.id()));
  readonly name = computed(() => (this.entry() ? displayName(this.entry()!) : '') || this.i18n.t('list.noName'));
  readonly changeUrl = computed(() => this.entry()?.passwordChangeUrl || this.entry()?.loginUrl || '');
  readonly password = signal('');
  readonly busy = signal(false);
  readonly error = signal('');

  async save(openSite: boolean): Promise<void> {
    if (!this.password() || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    // La entrada activa cambia de id al guardar: el enlace se toma antes.
    const url = this.changeUrl();
    try {
      const updated = await this.store.replacePassword(this.id(), this.password());
      this.password.set('');
      // Copiada para pegarla en la web; el portapapeles se limpia solo a los 20 s.
      if (openSite) {
        await this.store.svc.copyPassword(updated.id);
        this.nav.backTo({ name: 'detail', id: updated.id });
        this.toast.show(this.i18n.t('newpwd.done'), 4000);
        if (url && !(await this.store.svc.openExternal(url))) this.toast.show(this.i18n.t('detail.openFailed'));
      } else {
        this.toast.show(this.i18n.t('edit.saved'));
        this.nav.backTo({ name: 'detail', id: updated.id });
      }
    } catch {
      this.error.set(this.i18n.t('common.error'));
    } finally {
      this.busy.set(false);
    }
  }
}
