// Piezas comunes de la interfaz móvil: navegación con el botón Atrás del sistema, avisos breves,
// confirmaciones en hoja inferior e iconos.
import { ChangeDetectionStrategy, Component, Injectable, computed, inject, input, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

export type Tab = 'list' | 'health' | 'gen' | 'settings';
export type Screen =
  | { name: 'detail'; id: string }
  | { name: 'edit'; id?: string; password?: string }
  | { name: 'newpwd'; id: string }
  | { name: 'export' }
  | { name: 'import' }
  | { name: 'master' };

/** Pantallas apiladas sobre las pestañas; el botón Atrás de Android (historial de la WebView) las cierra. */
@Injectable({ providedIn: 'root' })
export class Nav {
  readonly tab = signal<Tab>('list');
  readonly stack = signal<Screen[]>([]);
  readonly top = computed(() => this.stack().at(-1) ?? null);

  constructor() {
    window.addEventListener('popstate', () => {
      if (this.stack().length) this.stack.update(s => s.slice(0, -1));
      else if (this.tab() !== 'list') this.tab.set('list');
      window.scrollTo(0, 0);
    });
  }

  go(tab: Tab): void {
    this.stack.set([]);
    if (tab !== 'list' && this.tab() === 'list') history.pushState({ kp: 'tab' }, '');
    this.tab.set(tab);
    window.scrollTo(0, 0);
  }

  push(screen: Screen): void {
    history.pushState({ kp: this.stack().length + 1 }, '');
    this.stack.update(s => [...s, screen]);
    window.scrollTo(0, 0);
  }

  /** Sustituye la pantalla de arriba (p. ej. el formulario por el detalle recién guardado). */
  replace(screen: Screen): void {
    this.stack.update(s => [...s.slice(0, -1), screen]);
    window.scrollTo(0, 0);
  }

  back(): void {
    history.back();
  }

  /** Cierra la pantalla de arriba y sustituye la de debajo (p. ej. el detalle por su versión nueva). */
  backTo(screen: Screen): void {
    const s = this.stack();
    if (s.length >= 2) this.stack.set([...s.slice(0, -2), screen, s[s.length - 1]]);
    history.back();
  }

  reset(): void {
    this.stack.set([]);
    this.tab.set('list');
  }
}

@Injectable({ providedIn: 'root' })
export class Toast {
  readonly message = signal<string | null>(null);
  private timer?: ReturnType<typeof setTimeout>;

  show(text: string, ms = 2600): void {
    this.message.set(text);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.message.set(null), ms);
  }
}

export type ConfirmRequest = { text: string; ok: string; danger: boolean; resolve: (v: boolean) => void };

@Injectable({ providedIn: 'root' })
export class Confirm {
  readonly request = signal<ConfirmRequest | null>(null);

  ask(text: string, ok: string, danger = true): Promise<boolean> {
    this.request()?.resolve(false);
    return new Promise(resolve => this.request.set({ text, ok, danger, resolve }));
  }

  answer(v: boolean): void {
    const r = this.request();
    this.request.set(null);
    r?.resolve(v);
  }
}

// Iconos de trazo (24×24), constantes del propio código.
const PATHS: Record<string, string> = {
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 20 3m-4 4 3 3m-5-1 2 2"/>',
  dice: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.2" fill="currentColor"/>',
  gear: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M15 18 9 12l6-6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.4 8.3 8 9 4.6-.7 8-4 8-9V6l-8-3z"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.6M8.2 13.2l7.6 4.6"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  pulse: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  sort: '<path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'
};

@Component({
  selector: 'kp-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg viewBox="0 0 24 24" [attr.width]="size()" [attr.height]="size()" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" [innerHTML]="svg()"></svg>`,
  styles: ':host{display:inline-flex;line-height:0}'
})
export class Icon {
  private readonly sanitizer = inject(DomSanitizer);
  readonly name = input.required<string>();
  readonly size = input(22);
  // Solo se insertan los trazos fijos de PATHS, nunca texto de la persona usuaria ni de la bóveda.
  readonly svg = computed<SafeHtml>(() => this.sanitizer.bypassSecurityTrustHtml(PATHS[this.name()] ?? ''));
}

/** Inicial y color estable para el avatar de cada entrada. */
export function avatarOf(name: string): { letter: string; hue: number } {
  const letter = (name.trim()[0] || '?').toUpperCase();
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return { letter, hue: h };
}
