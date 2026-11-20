// Campo de contraseña con el generador dentro y el análisis del núcleo (mismas reglas que el escritorio).
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, effect, inject, input, model, signal } from '@angular/core';
import { I18n } from '../i18n';
import { VaultStore } from '../vault';
import { Icon, Toast } from '../ui';
import { GeneratorOptions, DEFAULT_GENERATOR_OPTIONS, generatePassword } from '../../../../core/password-generator';

type Check = { level: 'ok' | 'warn' | 'danger'; codes: { code: string; params?: Record<string, string | number> }[] };

const OPTS_KEY = 'kp-mobile-gen';

/** Opciones del generador (no son secretas): se recuerdan en el teléfono. */
export function loadGenOptions(): GeneratorOptions {
  try {
    const raw = JSON.parse(localStorage.getItem(OPTS_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      const o = { ...DEFAULT_GENERATOR_OPTIONS, ...raw };
      o.length = Math.min(64, Math.max(8, Number(o.length) || 20));
      if (!o.upper && !o.lower && !o.numbers && !o.symbols) o.lower = true;
      return o;
    }
  } catch { /* opciones por defecto */ }
  return { ...DEFAULT_GENERATOR_OPTIONS };
}

export function saveGenOptions(o: GeneratorOptions): void {
  try { localStorage.setItem(OPTS_KEY, JSON.stringify(o)); } catch { /* sin persistencia */ }
}

@Component({
  selector: 'kp-password-field',
  standalone: true,
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="field">
    <span>{{ i18n.t('edit.password') }}</span>
    <div class="input-row">
      <input id="pwd-field" class="mono" [type]="show() ? 'text' : 'password'" [value]="value()" (input)="onInput($any($event.target).value)"
        autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="1024">
      <button type="button" class="icon-btn" (click)="show.set(!show())" [attr.aria-label]="i18n.t(show() ? 'common.hide' : 'common.show')">
        <kp-icon [name]="show() ? 'eyeOff' : 'eye'"/></button>
    </div>
    <div class="btn-pair">
      <button type="button" class="btn" (click)="generate()"><kp-icon name="dice"/>{{ i18n.t('edit.generate') }}</button>
      @if (copyable()) {
        <button type="button" class="btn" (click)="copy()" [disabled]="!value()"><kp-icon name="copy"/>{{ i18n.t('common.copy') }}</button>
      }
    </div>
    <details class="gen-opts">
      <summary>{{ i18n.t('gen.length', { n: opts().length }) }} · {{ classes() }}</summary>
      <input type="range" min="8" max="64" [value]="opts().length" (input)="setLength($any($event.target).value)" [attr.aria-label]="i18n.t('gen.length', { n: opts().length })">
      <div class="toggles">
        <label class="toggle"><input type="checkbox" [checked]="opts().upper" (change)="toggle('upper')">{{ i18n.t('gen.upper') }}</label>
        <label class="toggle"><input type="checkbox" [checked]="opts().lower" (change)="toggle('lower')">{{ i18n.t('gen.lower') }}</label>
        <label class="toggle"><input type="checkbox" [checked]="opts().numbers" (change)="toggle('numbers')">{{ i18n.t('gen.numbers') }}</label>
        <label class="toggle"><input type="checkbox" [checked]="opts().symbols" (change)="toggle('symbols')">{{ i18n.t('gen.symbols') }}</label>
      </div>
    </details>
    @if (value() && check(); as c) {
      <div class="strength" [attr.data-level]="c.level">
        <div class="meter"><i></i></div>
        <strong>{{ i18n.t('check.' + c.level) }}</strong>
        @for (r of c.codes; track $index) { <span class="reason">{{ i18n.t('check.reason.' + r.code, r.params) }}</span> }
      </div>
    }
  </div>`
})
export class PasswordField implements OnInit, OnDestroy {
  readonly i18n = inject(I18n);
  private readonly store = inject(VaultStore);
  private readonly toast = inject(Toast);
  readonly value = model('');
  readonly autoGenerate = input(false);
  readonly copyable = input(true);
  readonly show = signal(true);
  readonly opts = signal<GeneratorOptions>(loadGenOptions());
  readonly check = signal<Check | null>(null);
  private timer?: ReturnType<typeof setTimeout>;
  private seq = 0;

  constructor() {
    effect(() => this.analyze(this.value()));
  }

  ngOnInit(): void {
    if (this.autoGenerate() && !this.value()) this.generate();
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
  }

  classes(): string {
    const o = this.opts();
    return [o.upper && 'A-Z', o.lower && 'a-z', o.numbers && '0-9', o.symbols && '!#'].filter(Boolean).join(' ');
  }

  onInput(v: string): void {
    this.value.set(v);
  }

  generate(): void {
    this.value.set(generatePassword(this.opts()));
  }

  setLength(v: string): void {
    this.update({ ...this.opts(), length: Number(v) });
  }

  toggle(k: 'upper' | 'lower' | 'numbers' | 'symbols'): void {
    const o = { ...this.opts(), [k]: !this.opts()[k] };
    if (!o.upper && !o.lower && !o.numbers && !o.symbols) o.lower = true;
    this.update(o);
  }

  private update(o: GeneratorOptions): void {
    this.opts.set(o);
    saveGenOptions(o);
    this.generate();
  }

  async copy(): Promise<void> {
    const ok = await this.store.svc.copyText(this.value());
    this.toast.show(this.i18n.t(ok ? 'copy.done' : 'copy.fail'));
  }

  private analyze(pwd: string): void {
    clearTimeout(this.timer);
    const seq = ++this.seq;
    if (!pwd) {
      this.check.set(null);
      return;
    }
    this.timer = setTimeout(async () => {
      const r = (await this.store.svc.checkCandidate(pwd)) as Check;
      if (seq === this.seq) this.check.set(r);
    }, 250);
  }
}
