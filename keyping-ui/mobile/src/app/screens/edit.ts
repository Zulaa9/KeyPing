// Añadir o editar una entrada en una sola columna. Lo esencial arriba; el resto, plegado en «Más datos».
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { I18n } from '../i18n';
import { EntryMeta, VaultStore, cleanUrl } from '../vault';
import { Icon, Nav, Toast } from '../ui';
import { PasswordField } from './password-field';

@Component({
  selector: 'kp-edit',
  standalone: true,
  imports: [FormsModule, Icon, PasswordField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <header class="appbar">
    <button class="icon-btn" (click)="nav.back()" [attr.aria-label]="i18n.t('common.back')"><kp-icon name="back"/></button>
    <h1 class="appbar-title">{{ i18n.t(isNew() ? 'edit.newTitle' : 'edit.editTitle') }}</h1>
    <button class="text-btn" (click)="save()" [disabled]="busy()">{{ i18n.t('common.save') }}</button>
  </header>
  <form class="page stack" (ngSubmit)="save()">
    <label class="field">
      <span>{{ i18n.t('edit.label') }}</span>
      <input id="edit-label" name="label" [(ngModel)]="m.label" [placeholder]="i18n.t('edit.labelPh')" maxlength="512" enterkeyhint="next">
    </label>
    <label class="field">
      <span>{{ i18n.t('edit.username') }}</span>
      <input id="edit-username" name="username" [(ngModel)]="m.username" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="512">
    </label>
    @if (isNew()) {
      <kp-password-field [(value)]="password" [autoGenerate]="!initialPassword()"/>
    }
    <label class="field">
      <span>{{ i18n.t('edit.changeUrl') }}</span>
      <input id="edit-change-url" name="changeUrl" type="url" inputmode="url" [(ngModel)]="m.passwordChangeUrl" [placeholder]="i18n.t('edit.urlPh')"
        autocapitalize="off" spellcheck="false">
    </label>
    <details class="more" [open]="!isNew()">
      <summary>{{ i18n.t('edit.more') }}</summary>
      <label class="field">
        <span>{{ i18n.t('edit.email') }}</span>
        <input id="edit-email" name="email" type="email" inputmode="email" [(ngModel)]="m.email" autocomplete="off" maxlength="512">
      </label>
      <label class="field">
        <span>{{ i18n.t('edit.loginUrl') }}</span>
        <input id="edit-login-url" name="loginUrl" type="url" inputmode="url" [(ngModel)]="m.loginUrl" [placeholder]="i18n.t('edit.urlPh')"
          autocapitalize="off" spellcheck="false">
      </label>
      <label class="field">
        <span>{{ i18n.t('edit.folder') }}</span>
        <input id="edit-folder" name="folder" [(ngModel)]="m.folder" list="kp-folders" maxlength="128">
        <datalist id="kp-folders">@for (f of store.folders(); track f) { <option [value]="f"></option> }</datalist>
      </label>
      <label class="toggle row-toggle">
        <input id="edit-2fa" type="checkbox" name="twoFactor" [(ngModel)]="m.twoFactorEnabled">{{ i18n.t('edit.twoFactor') }}
      </label>
    </details>
    @if (error()) { <p class="msg error" role="alert">{{ error() }}</p> }
    <button class="btn primary big" type="submit" [disabled]="busy()"><kp-icon name="check"/>{{ i18n.t('common.save') }}</button>
  </form>`
})
export class EditScreen implements OnInit {
  readonly i18n = inject(I18n);
  readonly nav = inject(Nav);
  readonly store = inject(VaultStore);
  private readonly toast = inject(Toast);

  readonly id = input<string | undefined>(undefined);
  readonly initialPassword = input<string | undefined>(undefined);
  readonly isNew = computed(() => !this.id());
  readonly password = signal('');
  readonly busy = signal(false);
  readonly error = signal('');
  m: EntryMeta = { label: '', username: '', email: '', loginUrl: '', passwordChangeUrl: '', folder: '', twoFactorEnabled: false };

  ngOnInit(): void {
    const id = this.id();
    const e = id ? this.store.byId(id) : undefined;
    if (e) {
      this.m = {
        label: e.label || '', username: e.username || '', email: e.email || '', loginUrl: e.loginUrl || '',
        passwordChangeUrl: e.passwordChangeUrl || '', folder: e.folder || '', twoFactorEnabled: !!e.twoFactorEnabled
      };
    }
    if (this.initialPassword()) this.password.set(this.initialPassword()!);
  }

  async save(): Promise<void> {
    if (this.busy()) return;
    const label = this.m.label.trim();
    if (!label && !this.m.username.trim() && !this.m.email.trim()) return this.error.set(this.i18n.t('edit.needLabel'));
    if (this.isNew() && !this.password()) return this.error.set(this.i18n.t('edit.needPassword'));
    const login = cleanUrl(this.m.loginUrl);
    const change = cleanUrl(this.m.passwordChangeUrl);
    if (!login.ok || !change.ok) return this.error.set(this.i18n.t('edit.invalidUrl'));
    const meta: EntryMeta = {
      ...this.m, label, username: this.m.username.trim(), email: this.m.email.trim(), folder: this.m.folder.trim(),
      loginUrl: login.value, passwordChangeUrl: change.value
    };
    this.busy.set(true);
    this.error.set('');
    try {
      const saved = this.isNew() ? await this.store.add(this.password(), meta) : await this.store.updateMeta(this.id()!, meta);
      this.password.set('');
      this.toast.show(this.i18n.t('edit.saved'));
      if (this.isNew()) this.nav.replace({ name: 'detail', id: saved.id });
      else this.nav.back();
    } catch {
      this.error.set(this.i18n.t('common.error'));
    } finally {
      this.busy.set(false);
    }
  }
}
