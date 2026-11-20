// Retardos progresivos tras desbloqueos fallidos (núcleo compartido escritorio/móvil).
// El contador se persiste con el almacén que aporta cada plataforma, para que reiniciar la app
// no lo ponga a cero.

export type AttemptStore = {
  read(): Promise<string | null>;
  write(data: string): Promise<void>;
};

export const MAX_COOLDOWN_MS = 60 * 60 * 1000; // tope de 1 hora entre intentos

export type AttemptPolicy = { freeAttempts: number; baseDelayMs: number; growthFactor: number };
export const DEFAULT_POLICY: AttemptPolicy = { freeAttempts: 3, baseDelayMs: 5_000, growthFactor: 2 };

type StoredAttempts = { failedAttempts: number; nextUnlockAt: number; policy?: AttemptPolicy };

/** La política configurable desde Ajustes solo puede ser igual o más estricta que la de serie. */
export function clampPolicy(input: unknown): AttemptPolicy {
  const p = (input && typeof input === 'object' ? input : {}) as Partial<AttemptPolicy>;
  const free = Number(p.freeAttempts);
  const base = Number(p.baseDelayMs);
  const growth = Number(p.growthFactor);
  return {
    freeAttempts: Number.isFinite(free) ? Math.max(0, Math.min(DEFAULT_POLICY.freeAttempts, Math.round(free))) : DEFAULT_POLICY.freeAttempts,
    baseDelayMs: Number.isFinite(base) ? Math.max(DEFAULT_POLICY.baseDelayMs, Math.min(MAX_COOLDOWN_MS, Math.round(base))) : DEFAULT_POLICY.baseDelayMs,
    growthFactor: Number.isFinite(growth) ? Math.max(DEFAULT_POLICY.growthFactor, Math.min(10, growth)) : DEFAULT_POLICY.growthFactor
  };
}

export function cooldownFor(failedAttempts: number, policy: AttemptPolicy): number {
  if (failedAttempts <= policy.freeAttempts) return 0;
  const exponent = Math.max(0, failedAttempts - policy.freeAttempts - 1);
  return Math.min(MAX_COOLDOWN_MS, policy.baseDelayMs * Math.pow(policy.growthFactor, exponent));
}

export class AttemptGuard {
  private failedAttempts = 0;
  private nextUnlockAt = 0;
  private policy: AttemptPolicy = { ...DEFAULT_POLICY };

  constructor(private readonly store: AttemptStore, private readonly now: () => number = Date.now) {}

  async load(): Promise<void> {
    try {
      const raw = JSON.parse((await this.store.read()) ?? '') as Partial<StoredAttempts>;
      this.policy = clampPolicy(raw.policy);
      this.failedAttempts = Math.max(0, Math.min(1_000, Math.round(Number(raw.failedAttempts) || 0)));
      const next = Number(raw.nextUnlockAt) || 0;
      // Un reloj adelantado o un archivo manipulado no puede bloquear más del tope.
      this.nextUnlockAt = next > 0 ? Math.min(next, this.now() + MAX_COOLDOWN_MS) : 0;
    } catch {
      this.failedAttempts = 0;
      this.nextUnlockAt = 0;
    }
  }

  private writing: Promise<void> = Promise.resolve();

  // Escrituras en serie y siempre con el estado más reciente (varias llamadas seguidas no
  // pueden terminar dejando en disco una versión anterior).
  private persist(): Promise<void> {
    this.writing = this.writing.then(async () => {
      const data: StoredAttempts = { failedAttempts: this.failedAttempts, nextUnlockAt: this.nextUnlockAt, policy: this.policy };
      await this.store.write(JSON.stringify(data)).catch(() => {});
    });
    return this.writing;
  }

  /** Espera a que se hayan escrito los cambios pendientes (tests y cierre). */
  flush(): Promise<void> {
    return this.writing;
  }

  isCoolingDown(): boolean {
    return this.remainingMs() > 0;
  }

  remainingMs(): number {
    return Math.max(0, this.nextUnlockAt - this.now());
  }

  recordFailure(): void {
    this.failedAttempts++;
    const delay = cooldownFor(this.failedAttempts, this.policy);
    this.nextUnlockAt = delay > 0 ? this.now() + delay : 0;
    void this.persist();
  }

  async reset(): Promise<void> {
    if (this.failedAttempts === 0 && this.nextUnlockAt === 0) return;
    this.failedAttempts = 0;
    this.nextUnlockAt = 0;
    await this.persist();
  }

  async setPolicy(input: unknown): Promise<AttemptPolicy> {
    this.policy = clampPolicy(input);
    await this.persist();
    return { ...this.policy };
  }

  getPolicy(): AttemptPolicy {
    return { ...this.policy };
  }

  snapshot(): { failedAttempts: number; nextUnlockAt: number; remainingMs: number; policy: AttemptPolicy } {
    return {
      failedAttempts: this.failedAttempts,
      nextUnlockAt: this.nextUnlockAt,
      remainingMs: this.remainingMs(),
      policy: this.getPolicy()
    };
  }
}
