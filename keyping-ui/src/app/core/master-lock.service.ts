import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type MasterState = 'unset' | 'locked' | 'unlocked';

type StoredMaster = {
  salt: string; // base64
  check: string; // base64 de iv + cipher
  iterations: number;
};

const MIN_MASTER_LENGTH = 8;
const MASTER_PBKDF2_ITER = 600_000; // OWASP 2023: mínimo 600k para PBKDF2-SHA256
const MAX_AUTOLOCK_MINUTES = 30;    // Máximo 30 minutos para limitar exposición en sesión abierta

@Injectable({ providedIn: 'root' })
export class MasterLockService {
  // Estado global de autenticación maestra.
  readonly state$ = new BehaviorSubject<MasterState>('locked');

  private inactivityTimer: any;
  private inactivityMs = 5 * 60 * 1000;
  private autoLockMinutes = 5;

  private readonly masterStorageKey = 'keyping.master.v1';
  private readonly autoLockStorageKey = 'keyping.lock.autolock.v1';
  private readonly attemptPolicyKey = 'keyping.lock.policy.v1';
  private readonly attemptStateKey = 'keyping.lock.policy.state.v1';
  private attemptPolicy = {
    freeAttempts: 3,
    baseDelayMs: 5_000,
    growthFactor: 2
  };
  private failedAttempts = 0;
  private nextUnlockAt = 0;
  private lastCooldownMs = 0;

  /** Motivo del último desbloqueo o configuración fallidos (para mostrar un mensaje útil). */
  lastAuthError: { reason: string; dataDir?: string } | null = null;
  /** Aviso tras desbloquear: la contraseña es correcta pero el archivo del vault no se pudo leer. */
  lastUnlockWarning: string | null = null;
  private sessionLockedUnsub?: () => void;

  async init(): Promise<MasterState> {
    this.loadAutoLock();
    this.loadAttemptPolicy();
    this.loadAttemptState();
    await this.syncMainCooldown();

    // El proceso principal bloquea la sesión al suspender o bloquear el equipo.
    this.sessionLockedUnsub?.();
    this.sessionLockedUnsub = window.keyping?.onSessionLocked?.(() => this.lock());

    // Main process is the source of truth for vault existence.
    // localStorage may be empty (cleared, fresh OS profile, or first launch after upgrade)
    // while kp-auth.json already exists on disk — in that case show the lock screen,
    // not the create-vault screen, to avoid a silent Unauthorized error on authSetup.
    let vaultExists = false;
    try {
      vaultExists = !!(await window.keyping?.hasVault?.());
    } catch { /* no-op: treat as no vault */ }

    const stored = this.loadStoredMaster();
    const nextState: MasterState = (stored || vaultExists) ? 'locked' : 'unset';
    this.state$.next(nextState);
    return nextState;
  }

  lock(): void {
    clearTimeout(this.inactivityTimer);
    this.inactivityTimer = null;
    if (this.state$.value === 'unlocked') {
      this.state$.next('locked');
    }
    window.keyping?.sessionLock?.();
  }

  touch(): void {
    if (this.state$.value !== 'unlocked') return;
    clearTimeout(this.inactivityTimer);
    this.inactivityTimer = setTimeout(() => this.lock(), this.inactivityMs);
  }

  private normalizeResult(res: KeypingAuthResult | boolean | undefined | null): KeypingAuthResult {
    if (res === true) return { ok: true };
    if (!res) return { ok: false, reason: 'invalid' };
    return res;
  }

  private applyCooldownFromMain(res: KeypingAuthResult): void {
    if (!res.ok && typeof res.remainingMs === 'number' && res.remainingMs > 0) {
      this.nextUnlockAt = Date.now() + res.remainingMs;
      this.lastCooldownMs = res.remainingMs;
      this.persistAttemptState();
    }
  }

  async setMaster(password: string): Promise<void> {
    if (!password || password.length < MIN_MASTER_LENGTH) {
      throw new Error(`Master password must be at least ${MIN_MASTER_LENGTH} characters`);
    }

    // Main process creates kp-auth.json and derives the vault key from this password.
    const res = this.normalizeResult(await window.keyping?.authSetup?.(password));
    if (!res.ok) {
      this.lastAuthError = { reason: res.reason, dataDir: res.dataDir };
      throw new Error(`setup-failed:${res.reason}`);
    }
    this.lastAuthError = null;
    this.lastUnlockWarning = res.warning ?? null;

    // El proceso principal es la única fuente de verdad: ya no se guarda ningún verificador
    // derivado de la contraseña en localStorage (y se borran los de versiones anteriores).
    localStorage.removeItem(this.masterStorageKey);
    localStorage.removeItem('keyping.vault.enc.v1');

    this.state$.next('unlocked');
    this.clearAttemptState();
    this.touch();
  }

  /**
   * Primera ejecución importando una bóveda (.kpenc de otro equipo o del móvil): el proceso principal
   * comprueba el archivo, crea la bóveda con la contraseña con la que se exportó y lo importa entero.
   */
  async setupFromImport(raw: string, password: string): Promise<KeypingSetupImportResult> {
    let res: KeypingSetupImportResult;
    try {
      res = (await window.keyping?.authSetupFromImport?.(raw, password)) ?? { ok: false, reason: 'error' };
    } catch {
      res = { ok: false, reason: 'error' };
    }
    if (!res.ok) return res;

    this.lastAuthError = null;
    this.lastUnlockWarning = res.warning === 'vault-unreadable' ? 'vault-unreadable' : null;
    localStorage.removeItem(this.masterStorageKey);
    localStorage.removeItem('keyping.vault.enc.v1');
    this.state$.next('unlocked');
    this.clearAttemptState();
    this.touch();
    return res;
  }

  async unlock(password: string): Promise<boolean> {
    const now = Date.now();
    this.expireCooldownIfElapsed(now);
    if (now < this.nextUnlockAt) {
      this.lastCooldownMs = this.nextUnlockAt - now;
      this.lastAuthError = { reason: 'cooldown' };
      return false;
    }

    // Main process verifies the password and derives the vault encryption key.
    // El verificador heredado (<= 1.0.x) solo se usa si hay que migrar desde kp-master.key.
    let res: KeypingAuthResult;
    try {
      res = this.normalizeResult(await window.keyping?.authUnlock?.(password, this.loadStoredMaster()));
    } catch (err) {
      console.warn('[master] authUnlock IPC error');
      res = { ok: false, reason: 'error' };
    }

    if (!res.ok) {
      this.lastAuthError = { reason: res.reason, dataDir: res.dataDir };
      if (res.reason === 'invalid' || res.reason === 'cooldown') {
        this.handleFailedAttempt();
        this.applyCooldownFromMain(res);
      }
      return false;
    }

    this.lastAuthError = null;
    this.lastUnlockWarning = res.warning ?? null;
    // Remove any stale vault cache / verifier from previous versions.
    localStorage.removeItem('keyping.vault.enc.v1');
    localStorage.removeItem(this.masterStorageKey);

    this.state$.next('unlocked');
    this.failedAttempts = 0;
    this.nextUnlockAt = 0;
    this.lastCooldownMs = 0;
    this.clearAttemptState();
    this.touch();
    return true;
  }

  private loadStoredMaster(): StoredMaster | null {
    try {
      const raw = localStorage.getItem(this.masterStorageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed?.salt === 'string' && typeof parsed?.check === 'string') {
        const rawIter = Number(parsed.iterations) || MASTER_PBKDF2_ITER;
        return {
          salt: parsed.salt,
          check: parsed.check,
          iterations: Math.min(2_000_000, Math.max(100_000, Math.round(rawIter)))
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  setAutoLockMinutes(minutes: number): void {
    const clamped = Math.max(1, Math.min(MAX_AUTOLOCK_MINUTES, Math.round(minutes)));
    this.autoLockMinutes = clamped;
    this.inactivityMs = clamped * 60 * 1000;
    localStorage.setItem(this.autoLockStorageKey, JSON.stringify({ minutes: clamped }));
    this.touch();
  }

  getAutoLockMinutes(): number {
    return this.autoLockMinutes;
  }

  setAttemptPolicy(freeAttempts: number, baseDelayMs: number, growthFactor: number): void {
    this.attemptPolicy = {
      freeAttempts: Math.max(0, Math.min(10, Math.round(freeAttempts))),
      baseDelayMs: Math.max(500, Math.round(baseDelayMs)),
      growthFactor: Math.max(1.2, growthFactor || 2)
    };
    this.failedAttempts = 0;
    this.nextUnlockAt = 0;
    this.lastCooldownMs = 0;
    localStorage.setItem(this.attemptPolicyKey, JSON.stringify(this.attemptPolicy));
    this.clearAttemptState();
    // El proceso principal aplica la política (solo puede ser igual o más estricta que la de serie).
    void window.keyping?.setAttemptPolicy?.(this.attemptPolicy)?.catch?.(() => {});
  }

  getAttemptPolicy(): { freeAttempts: number; baseDelayMs: number; growthFactor: number } {
    return { ...this.attemptPolicy };
  }

  getCooldownSeconds(): number {
    const now = Date.now();
    this.expireCooldownIfElapsed(now);
    const ms = Math.max(0, (this.nextUnlockAt || 0) - now);
    return Math.ceil(ms / 1000);
  }

  /** Cambia la contraseña maestra (verificada en el proceso principal) y bloquea la sesión. */
  async rotateMaster(current: string, next: string): Promise<boolean> {
    let res: KeypingAuthResult;
    try {
      res = (await window.keyping?.authChange?.(current, next)) ?? { ok: false, reason: 'error' };
    } catch {
      res = { ok: false, reason: 'error' };
    }
    if (!res.ok) {
      this.lastAuthError = { reason: res.reason, dataDir: res.dataDir };
      this.applyCooldownFromMain(res);
      return false;
    }
    this.lastAuthError = null;
    localStorage.removeItem(this.masterStorageKey);
    this.lock();
    return true;
  }

  private loadAutoLock(): void {
    try {
      const raw = JSON.parse(localStorage.getItem(this.autoLockStorageKey) || '{}');
      if (typeof raw?.minutes === 'number' && raw.minutes > 0) {
        this.autoLockMinutes = Math.max(1, Math.min(MAX_AUTOLOCK_MINUTES, Math.round(raw.minutes)));
        this.inactivityMs = this.autoLockMinutes * 60 * 1000;
      }
    } catch {
      this.autoLockMinutes = 5;
      this.inactivityMs = this.autoLockMinutes * 60 * 1000;
    }
  }

  private loadAttemptPolicy(): void {
    try {
      const raw = JSON.parse(localStorage.getItem(this.attemptPolicyKey) || '{}');
      if (raw && typeof raw === 'object') {
        this.attemptPolicy = {
          freeAttempts: Math.max(0, Math.min(10, Number((raw as any).freeAttempts ?? (raw as any).limit) || 3)),
          baseDelayMs: Math.max(500, Number((raw as any).baseDelayMs) || 5000),
          growthFactor: Math.max(1.2, Number((raw as any).growthFactor) || 2)
        };
      }
    } catch {
      this.attemptPolicy = {
        freeAttempts: 3,
        baseDelayMs: 5_000,
        growthFactor: 2
      };
    }
  }

  private loadAttemptState(): void {
    try {
      const raw = JSON.parse(localStorage.getItem(this.attemptStateKey) || '{}');
      if (raw && typeof raw === 'object') {
        this.failedAttempts = Math.max(0, Number((raw as any).failedAttempts) || 0);
        this.nextUnlockAt = Math.max(0, Number((raw as any).nextUnlockAt) || 0);
        this.lastCooldownMs = Math.max(0, Number((raw as any).lastCooldownMs) || 0);
        this.expireCooldownIfElapsed();
      }
    } catch {
      this.failedAttempts = 0;
      this.nextUnlockAt = 0;
      this.lastCooldownMs = 0;
    }
  }

  private async syncMainCooldown(): Promise<void> {
    try {
      const state = await window.keyping?.getMainCooldown?.();
      if (state && state.nextUnlockAt > this.nextUnlockAt) {
        this.failedAttempts = Math.max(this.failedAttempts, state.failedAttempts);
        this.nextUnlockAt = state.nextUnlockAt;
        this.lastCooldownMs = state.remainingMs || 0;
        this.persistAttemptState();
      }
    } catch {
      // No-op: sincronización de mejor esfuerzo.
    }
  }

  private handleFailedAttempt(): void {
    this.failedAttempts++;

    if (this.failedAttempts <= this.attemptPolicy.freeAttempts) {
      this.nextUnlockAt = 0;
      this.lastCooldownMs = 0;
    } else {
      const exponent = Math.max(0, this.failedAttempts - this.attemptPolicy.freeAttempts - 1);
      const rawDelay = this.attemptPolicy.baseDelayMs * Math.pow(this.attemptPolicy.growthFactor, exponent);
      const delay = Math.min(Number.MAX_SAFE_INTEGER / 2, rawDelay);
      this.nextUnlockAt = Date.now() + delay;
      this.lastCooldownMs = delay;
      this.persistAttemptState();
    }
  }

  private persistAttemptState(): void {
    localStorage.setItem(
      this.attemptStateKey,
      JSON.stringify({
        failedAttempts: this.failedAttempts,
        nextUnlockAt: this.nextUnlockAt,
        lastCooldownMs: this.lastCooldownMs
      })
    );
  }

  private clearAttemptState(): void {
    this.failedAttempts = 0;
    this.nextUnlockAt = 0;
    this.lastCooldownMs = 0;
    localStorage.removeItem(this.attemptStateKey);
  }

  private expireCooldownIfElapsed(now: number = Date.now()): void {
    if (this.nextUnlockAt > 0 && now >= this.nextUnlockAt) {
      this.nextUnlockAt = 0;
      this.lastCooldownMs = 0;
      this.persistAttemptState();
    }
  }
}
