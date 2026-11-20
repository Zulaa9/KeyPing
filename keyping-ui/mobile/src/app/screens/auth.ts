// Crear la bóveda y desbloquearla. Mismo núcleo que el escritorio: PBKDF2-HMAC-SHA512 600 000 iteraciones.
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { I18n } from '../i18n';
import { VaultStore } from '../vault';
import { Icon } from '../ui';
import { platform } from '../platform/mobile-bridge';
import { classifyImport, decryptMasterExport } from '../../../../core/export-format';
import { webCrypto } from '../../../../core/web-crypto';

@Component({
  selector: 'kp-setup',
  standalone: true,
  imports: [FormsModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <main class="auth">
    <img class="auth-logo" src="logo.png" alt="" width="72" height="72">
    @if (mode() === 'restore') {
      <h1>{{ i18n.t('restore.title') }}</h1>
      <p class="muted">{{ i18n.t('restore.lead') }}</p>
      @if (!fileName()) {
        <button class="btn primary big" (click)="pickFile()" [disabled]="busy()"><kp-icon name="upload"/>{{ i18n.t('imp.pick') }}</button>
      } @else {
        <p class="file-name center">{{ fileName() }}</p>
        <form (ngSubmit)="restore()" class="stack">
          <label class="field">
            <span>{{ i18n.t('restore.password') }}</span>
            <input id="restore-pwd" type="password" name="rpwd" [(ngModel)]="pwd" autocomplete="off" autocapitalize="off"
              spellcheck="false" [disabled]="busy()">
          </label>
          <p class="hint">{{ i18n.t('restore.passwordHint') }}</p>
          <button class="btn primary big" type="submit" [disabled]="busy() || !pwd">
            {{ busy() ? i18n.t('setup.creating') : i18n.t('restore.submit') }}</button>
        </form>
      }
      @if (error()) { <p class="msg error" role="alert">{{ error() }}</p> }
      <button class="btn ghost" (click)="setMode('new')" [disabled]="busy()">{{ i18n.t('restore.back') }}</button>
    } @else {
    <h1>{{ i18n.t('setup.title') }}</h1>
    <p class="muted">{{ i18n.t('setup.lead') }}</p>
    <form (ngSubmit)="create()" class="stack">
      <label class="field">
        <span>{{ i18n.t('setup.password') }}</span>
        <div class="input-row">
          <input id="setup-pwd" [type]="show() ? 'text' : 'password'" name="pwd" [(ngModel)]="pwd" autocomplete="new-password"
            autocapitalize="off" spellcheck="false" [disabled]="busy()" enterkeyhint="next">
          <button type="button" class="icon-btn" (click)="show.set(!show())" [attr.aria-label]="i18n.t(show() ? 'common.hide' : 'common.show')">
            <kp-icon [name]="show() ? 'eyeOff' : 'eye'"/></button>
        </div>
      </label>
      <label class="field">
        <span>{{ i18n.t('setup.confirm') }}</span>
        <input id="setup-confirm" [type]="show() ? 'text' : 'password'" name="confirm" [(ngModel)]="confirm" autocomplete="new-password"
          autocapitalize="off" spellcheck="false" [disabled]="busy()" enterkeyhint="done">
      </label>
      <p class="hint">{{ i18n.t('setup.min') }}</p>
      @if (error()) { <p class="msg error" role="alert">{{ error() }}</p> }
      <button class="btn primary big" type="submit" [disabled]="busy() || pwd.length < 8 || !confirm">
        {{ busy() ? i18n.t('setup.creating') : i18n.t('setup.create') }}</button>
    </form>
    <div class="divider"><span>{{ i18n.t('restore.or') }}</span></div>
    <button class="btn big" (click)="setMode('restore')" [disabled]="busy()"><kp-icon name="upload"/>{{ i18n.t('restore.cta') }}</button>
    <p class="hint center">{{ i18n.t('restore.ctaHint') }}</p>
    }
  </main>`
})
export class SetupScreen {
  readonly i18n = inject(I18n);
  private readonly store = inject(VaultStore);
  pwd = '';
  confirm = '';
  readonly show = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly mode = signal<'new' | 'restore'>('new');
  readonly fileName = signal('');
  private raw = '';

  setMode(m: 'new' | 'restore'): void {
    this.mode.set(m);
    this.error.set('');
    this.fileName.set('');
    this.raw = this.pwd = this.confirm = '';
  }

  async pickFile(): Promise<void> {
    this.error.set('');
    const p = platform();
    const r = await p.withSystemUi(() => p.extras.pickImportFile()).catch(() => ({ error: 'read-error' as const }));
    if (!r) return;
    if ('error' in r) return this.error.set(this.i18n.t(r.error === 'too-large' ? 'imp.err.tooLarge' : 'imp.err.invalid'));
    try {
      if (classifyImport(r.text).kind !== 'master') throw new Error('not-portable');
    } catch {
      return this.error.set(this.i18n.t('restore.notPortable'));
    }
    this.raw = r.text;
    this.fileName.set(r.name || '.kpenc');
  }

  /**
   * Restaurar en un teléfono nuevo: la bóveda se crea con la misma contraseña con la que se exportó el
   * archivo (la maestra del escritorio) y se importa entero, historial incluido.
   */
  async restore(): Promise<void> {
    if (!this.pwd || !this.raw || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const kind = classifyImport(this.raw);
      if (kind.kind !== 'master') throw new Error('not-portable');
      try {
        await decryptMasterExport(kind.payload, this.pwd, webCrypto); // se comprueba antes de crear nada
      } catch {
        return this.error.set(this.i18n.t('imp.err.wrongPassword'));
      }
      if (this.pwd.length < 8) return this.error.set(this.i18n.t('restore.tooShort'));
      const svc = this.store.svc;
      const r = await svc.authSetup(this.pwd);
      if (!r.ok) throw new Error(r.reason);
      await svc.parseImport(this.raw, this.pwd);
      await svc.importVault('overwrite');
      this.raw = this.pwd = '';
      await this.store.afterUnlock();
    } catch {
      this.error.set(this.i18n.t('common.error'));
    } finally {
      this.busy.set(false);
    }
  }

  async create(): Promise<void> {
    if (this.pwd.length < 8) return;
    if (this.pwd !== this.confirm) {
      this.error.set(this.i18n.t('setup.mismatch'));
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const r = await this.store.svc.authSetup(this.pwd);
      if (!r.ok) throw new Error(r.reason);
      this.pwd = this.confirm = '';
      await this.store.afterUnlock();
    } catch {
      this.error.set(this.i18n.t('common.error'));
    } finally {
      this.busy.set(false);
    }
  }
}

@Component({
  selector: 'kp-unlock',
  standalone: true,
  imports: [FormsModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <main class="auth">
    <div class="auth-lock"><kp-icon name="lock" [size]="34"/></div>
    <h1>{{ i18n.t('unlock.title') }}</h1>
    <form (ngSubmit)="unlock()" class="stack">
      <label class="field">
        <span>{{ i18n.t('unlock.password') }}</span>
        <div class="input-row">
          <input id="unlock-pwd" [type]="show() ? 'text' : 'password'" name="pwd" [(ngModel)]="pwd" autocomplete="current-password"
            autocapitalize="off" spellcheck="false" [disabled]="busy() || cooldown() > 0" enterkeyhint="go" autofocus>
          <button type="button" class="icon-btn" (click)="show.set(!show())" [attr.aria-label]="i18n.t(show() ? 'common.hide' : 'common.show')">
            <kp-icon [name]="show() ? 'eyeOff' : 'eye'"/></button>
        </div>
      </label>
      @if (cooldown() > 0) {
        <p class="msg warn" role="status">{{ i18n.t('unlock.cooldown', { s: cooldown() }) }}</p>
      } @else if (error()) {
        <p class="msg error" role="alert">{{ error() }}</p>
      }
      <button class="btn primary big" type="submit" [disabled]="busy() || !pwd || cooldown() > 0">
        {{ busy() ? i18n.t('unlock.checking') : i18n.t('unlock.submit') }}</button>
    </form>
  </main>`
})
export class UnlockScreen implements OnInit, OnDestroy {
  readonly i18n = inject(I18n);
  private readonly store = inject(VaultStore);
  pwd = '';
  readonly show = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly cooldown = signal(0);
  private tick?: ReturnType<typeof setInterval>;

  async ngOnInit(): Promise<void> {
    const snap = await this.store.svc.getMainCooldown();
    if (snap.remainingMs > 0) this.startCooldown(snap.remainingMs);
  }

  ngOnDestroy(): void {
    clearInterval(this.tick);
    this.pwd = '';
  }

  async unlock(): Promise<void> {
    if (!this.pwd || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const r = await this.store.svc.authUnlock(this.pwd);
      if (r.ok) {
        this.pwd = '';
        await this.store.afterUnlock();
        return;
      }
      if (r.reason === 'cooldown') this.startCooldown(r.remainingMs ?? 0);
      else if (r.reason === 'vault-unreadable') this.error.set(this.i18n.t('unlock.unreadable'));
      else if (r.reason === 'invalid') {
        this.error.set(this.i18n.t('unlock.invalid'));
        const snap = await this.store.svc.getMainCooldown();
        if (snap.remainingMs > 0) this.startCooldown(snap.remainingMs);
      } else this.error.set(this.i18n.t('common.error'));
      this.pwd = '';
    } finally {
      this.busy.set(false);
    }
  }

  private startCooldown(ms: number): void {
    const until = Date.now() + ms;
    const update = () => {
      const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      this.cooldown.set(left);
      if (!left) clearInterval(this.tick);
    };
    clearInterval(this.tick);
    update();
    this.tick = setInterval(update, 500);
  }
}
