// Crear la bóveda y desbloquearla. Mismo núcleo que el escritorio: PBKDF2-HMAC-SHA512 600 000 iteraciones.
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { I18n } from '../i18n';
import { VaultStore } from '../vault';
import { Icon } from '../ui';

@Component({
  selector: 'kp-setup',
  standalone: true,
  imports: [FormsModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <main class="auth">
    <img class="auth-logo" src="logo.png" alt="" width="72" height="72">
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
    <p class="hint center">{{ i18n.t('setup.hint') }}</p>
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
