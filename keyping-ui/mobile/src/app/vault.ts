// Estado de la app móvil sobre el núcleo compartido (KeypingService). Sin red y sin copias en memoria de
// los secretos: la lista solo tiene datos públicos; la contraseña se pide al núcleo cuando hace falta.
import { Injectable, computed, signal } from '@angular/core';
import { platform } from './platform/mobile-bridge';
import { checkEntryUrl } from '../../../core/url-utils';

export type Entry = {
  id: string;
  createdAt: number;
  updatedAt?: number;
  length: number;
  label?: string;
  loginUrl?: string;
  passwordChangeUrl?: string;
  username?: string;
  email?: string;
  folder?: string;
  twoFactorEnabled?: boolean;
  active?: boolean;
  previousId?: string;
};

export type EntryMeta = {
  label: string;
  username: string;
  email: string;
  loginUrl: string;
  passwordChangeUrl: string;
  folder: string;
  twoFactorEnabled: boolean;
};

export type Phase = 'loading' | 'setup' | 'locked' | 'unlocked';

const AUTOLOCK_KEY = 'kp-mobile-autolock-min';
export const AUTOLOCK_OPTIONS = [1, 5, 15] as const;

/** Texto sin tildes ni mayúsculas para buscar («nandu» encuentra «Ñandú»). */
export function fold(s: string | undefined): string {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function displayName(e: Entry): string {
  return e.label || e.username || e.email || hostOf(e.loginUrl) || '';
}

export function hostOf(url?: string): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Valida y normaliza un enlace como el escritorio: vacío o http(s) sin credenciales. */
export function cleanUrl(raw: string): { ok: boolean; value: string } {
  if (!raw.trim()) return { ok: true, value: '' };
  const r = checkEntryUrl(raw);
  return r.ok ? { ok: true, value: r.value } : { ok: false, value: '' };
}

@Injectable({ providedIn: 'root' })
export class VaultStore {
  readonly phase = signal<Phase>('loading');
  readonly entries = signal<Entry[]>([]);
  readonly loadError = signal(false);
  readonly autoLockMin = signal<number>(readAutoLock());
  readonly folders = computed(() =>
    [...new Set(this.entries().map(e => (e.folder || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  );

  private idleTimer?: ReturnType<typeof setTimeout>;
  private readonly lockListeners = new Set<() => void>();

  get svc() {
    return platform().service;
  }

  async init(): Promise<void> {
    this.svc.onSessionLocked(() => this.onLocked());
    for (const ev of ['pointerdown', 'keydown', 'input', 'scroll'] as const) {
      document.addEventListener(ev, () => this.bumpIdle(), { passive: true, capture: true });
    }
    this.phase.set((await this.svc.hasVault()) ? 'locked' : 'setup');
  }

  onLock(fn: () => void): void {
    this.lockListeners.add(fn);
  }

  private onLocked(): void {
    // Lo primero: retirar de la pantalla todo lo que estaba a la vista.
    clearTimeout(this.idleTimer);
    this.entries.set([]);
    if (this.phase() !== 'setup') this.phase.set('locked');
    for (const fn of this.lockListeners) fn();
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  private bumpIdle(): void {
    if (this.phase() !== 'unlocked') return;
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.svc.lockNow(true), this.autoLockMin() * 60_000);
  }

  setAutoLock(min: number): void {
    this.autoLockMin.set(min);
    try { localStorage.setItem(AUTOLOCK_KEY, String(min)); } catch { /* sin persistencia */ }
    this.bumpIdle();
  }

  async afterUnlock(): Promise<void> {
    this.phase.set('unlocked');
    this.bumpIdle();
    await this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      const list = (await this.svc.listPasswords()) as Entry[];
      this.loadError.set(false);
      this.entries.set([...list].sort((a, b) => fold(displayName(a)).localeCompare(fold(displayName(b)))));
    } catch {
      this.loadError.set(true);
    }
  }

  lock(): void {
    this.svc.lockNow(true);
  }

  byId(id: string): Entry | undefined {
    return this.entries().find(e => e.id === id);
  }

  async add(password: string, m: EntryMeta): Promise<Entry> {
    const e = (await this.svc.savePassword(password, m.label, m.loginUrl, m.passwordChangeUrl, m.username, m.email,
      m.folder, m.twoFactorEnabled)) as Entry;
    await this.refresh();
    return e;
  }

  async updateMeta(id: string, m: EntryMeta): Promise<Entry> {
    const e = (await this.svc.updateMeta(id, m.label, m.loginUrl, m.passwordChangeUrl, m.username, m.email, m.folder,
      m.twoFactorEnabled)) as Entry;
    await this.refresh();
    return e;
  }

  /** Nueva versión de la contraseña: la anterior pasa al historial. Devuelve el id de la versión activa. */
  async replacePassword(id: string, password: string): Promise<Entry> {
    const e = (await this.svc.updatePassword(id, password)) as Entry;
    await this.refresh();
    return e;
  }

  async remove(id: string): Promise<void> {
    await this.svc.deletePassword(id);
    await this.refresh();
  }
}

function readAutoLock(): number {
  try {
    const v = Number(localStorage.getItem(AUTOLOCK_KEY));
    if ((AUTOLOCK_OPTIONS as readonly number[]).includes(v)) return v;
  } catch { /* sin persistencia */ }
  return 5;
}
