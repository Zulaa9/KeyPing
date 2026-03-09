export type ClipboardTimerHandle = ReturnType<typeof setTimeout>;

export type ClipboardClearDeps = {
  readClipboardText: () => string;
  clearClipboard: () => void;
  clearWindowsClipboardHistory?: () => Promise<boolean>;
  schedule: (fn: () => void, ttlMs: number) => ClipboardTimerHandle;
  cancel: (handle: ClipboardTimerHandle) => void;
  now?: () => number;
  warn?: (message: string, err?: unknown) => void;
};

export type ClipboardClearSession = {
  id: number;
  value: string;
  startedAt: number;
  ttlMs: number;
};

type ActiveSession = ClipboardClearSession & {
  timer: ClipboardTimerHandle;
};

export class ClipboardClearSessionManager {
  private nextId = 1;
  private active: ActiveSession | null = null;
  private disposed = false;

  constructor(private readonly deps: ClipboardClearDeps) {}

  startSession(value: string, ttlMs: number): ClipboardClearSession {
    if (this.disposed) {
      throw new Error('ClipboardClearSessionManager is disposed');
    }

    this.invalidateActive();

    const session: ClipboardClearSession = {
      id: this.nextId++,
      value,
      startedAt: (this.deps.now ?? Date.now)(),
      ttlMs
    };

    const timer = this.deps.schedule(() => {
      void this.tryExpireSession(session.id, session.value);
    }, ttlMs);

    this.active = { ...session, timer };
    return session;
  }

  invalidateActive(): void {
    if (!this.active) return;
    this.deps.cancel(this.active.timer);
    this.active = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.invalidateActive();
  }

  getActiveSession(): ClipboardClearSession | null {
    if (!this.active) return null;
    const { timer: _timer, ...session } = this.active;
    return session;
  }

  private async tryExpireSession(id: number, expectedValue: string): Promise<void> {
    if (this.disposed) return;
    if (!this.active || this.active.id !== id) return;

    try {
      const current = this.deps.readClipboardText();
      if (current !== expectedValue) {
        return;
      }

      this.deps.clearClipboard();
      if (this.deps.clearWindowsClipboardHistory) {
        await this.deps.clearWindowsClipboardHistory();
      }
    } catch (err) {
      this.deps.warn?.('[main] clipboard guarded clear failed', err);
    } finally {
      if (this.active?.id === id) {
        this.active = null;
      }
    }
  }
}
