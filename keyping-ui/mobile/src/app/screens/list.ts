// Pestaña Contraseñas: buscador fijo, carpetas en chips y filas grandes. Tocar una fila abre el detalle.
import { ChangeDetectionStrategy, Component, Injectable, computed, inject, signal } from '@angular/core';
import { I18n } from '../i18n';
import { Entry, VaultStore, displayName, fold, hostOf } from '../vault';
import { Icon, Nav, avatarOf } from '../ui';

/** Búsqueda y carpeta elegidas: se mantienen al volver del detalle. */
@Injectable({ providedIn: 'root' })
export class ListState {
  readonly query = signal('');
  readonly folder = signal<string | null>(null);
}

@Component({
  selector: 'kp-list',
  standalone: true,
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <header class="appbar large">
    <div class="appbar-row">
      <h1>{{ i18n.t('tab.passwords') }}</h1>
      <button class="icon-btn" (click)="store.lock()" [attr.aria-label]="i18n.t('list.lock')"><kp-icon name="lock"/></button>
    </div>
    <label class="search">
      <kp-icon name="search" [size]="20"/>
      <input id="search" type="search" [value]="state.query()" (input)="state.query.set($any($event.target).value)"
        (keydown.enter)="openFirst()" [placeholder]="i18n.t('list.search')" autocomplete="off" autocapitalize="off"
        spellcheck="false" enterkeyhint="search">
    </label>
    @if (store.folders().length) {
      <div class="chips" role="tablist">
        <button class="chip" role="tab" [class.on]="state.folder() === null" (click)="state.folder.set(null)">{{ i18n.t('list.all') }}</button>
        @for (f of store.folders(); track f) {
          <button class="chip" role="tab" [class.on]="state.folder() === f" (click)="state.folder.set(f)">{{ f }}</button>
        }
      </div>
    }
  </header>

  @if (!store.entries().length) {
    <section class="empty">
      <div class="empty-icon"><kp-icon name="key" [size]="40"/></div>
      <h2>{{ i18n.t('list.empty.title') }}</h2>
      <p class="muted">{{ i18n.t('list.empty.lead') }}</p>
      <button class="btn primary" (click)="nav.push({ name: 'edit' })"><kp-icon name="plus"/>{{ i18n.t('list.empty.add') }}</button>
      <button class="btn" (click)="nav.push({ name: 'import' })"><kp-icon name="upload"/>{{ i18n.t('list.empty.import') }}</button>
    </section>
  } @else {
    <p class="count muted">{{ i18n.t('list.count', { n: store.entries().length }) }}</p>
    <ul class="rows">
      @for (e of filtered(); track e.id) {
        <li>
          <button class="row" (click)="open(e)">
            <span class="avatar" [style.--h]="avatar(e).hue">{{ avatar(e).letter }}</span>
            <span class="row-text">
              <span class="row-title">{{ name(e) }}</span>
              @if (sub(e)) { <span class="row-sub">{{ sub(e) }}</span> }
            </span>
            <kp-icon name="chevron" [size]="20"/>
          </button>
        </li>
      } @empty {
        <li class="none muted">{{ i18n.t('list.noResults', { q: state.query() }) }}</li>
      }
    </ul>
  }
  <button class="fab" (click)="nav.push({ name: 'edit' })" [attr.aria-label]="i18n.t('list.add')"><kp-icon name="plus" [size]="28"/></button>`
})
export class ListScreen {
  readonly i18n = inject(I18n);
  readonly store = inject(VaultStore);
  readonly nav = inject(Nav);
  readonly state = inject(ListState);

  readonly filtered = computed(() => {
    const q = fold(this.state.query().trim());
    const folder = this.state.folder();
    return this.store.entries().filter(e => {
      if (folder !== null && (e.folder || '').trim() !== folder) return false;
      if (!q) return true;
      return [e.label, e.username, e.email, e.folder, hostOf(e.loginUrl), hostOf(e.passwordChangeUrl)].some(v => fold(v).includes(q));
    });
  });

  name(e: Entry): string {
    return displayName(e) || this.i18n.t('list.noName');
  }

  sub(e: Entry): string {
    const parts = [e.username || e.email, hostOf(e.loginUrl)].filter(Boolean);
    return [...new Set(parts)].join(' · ');
  }

  avatar(e: Entry) {
    return avatarOf(this.name(e));
  }

  open(e: Entry): void {
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.nav.push({ name: 'detail', id: e.id });
  }

  /** Intro en el buscador abre el primer resultado: buscar y abrir sin soltar el teclado. */
  openFirst(): void {
    const first = this.filtered()[0];
    if (first) this.open(first);
  }
}
