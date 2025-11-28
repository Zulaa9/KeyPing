import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type MasterState = 'unset' | 'locked' | 'unlocked';

type StoredMaster = {
  salt: string; // base64
  check: string; // base64 de iv + cipher
  iterations: number;
};

@Injectable({ providedIn: 'root' })
export class MasterLockService {
  readonly state$ = new BehaviorSubject<MasterState>('locked');

  private masterKey: CryptoKey | null = null;
  private inactivityTimer: any;
  private inactivityMs = 5 * 60 * 1000; // default 5 minutos, configurable
  private autoLockMinutes = 5;

  private readonly masterStorageKey = 'keyping.master.v1';
  private readonly vaultStorageKey = 'keyping.vault.enc.v1';
  private readonly autoLockStorageKey = 'keyping.lock.autolock.v1';
  private readonly attemptPolicyKey = 'keyping.lock.policy.v1';
  private readonly attemptStateKey = 'keyping.lock.policy.state.v1';
  private readonly verificationText = 'keyping-master-check';
  private attemptPolicy = {
    freeAttempts: 3,
    baseDelayMs: 5_000,
    growthFactor: 2
  };
  private failedAttempts = 0;
  private nextUnlockAt = 0;
  private lastCooldownMs = 0;

  async init(): Promise<MasterState> {
    this.loadAutoLock();
    this.loadAttemptPolicy();
    this.loadAttemptState();
    const stored = this.loadStoredMaster();
    const nextState: MasterState = stored ? 'locked' : 'unset';
    this.state$.next(nextState);
    return nextState;
  }

  lock(): void {
    this.masterKey = null;
    clearTimeout(this.inactivityTimer);
    this.inactivityTimer = null;
    if (this.state$.value !== 'unset') {
      this.state$.next('locked');
    }
  }

  touch(): void {
    if (this.state$.value !== 'unlocked') return;
    clearTimeout(this.inactivityTimer);
    this.inactivityTimer = setTimeout(() => this.lock(), this.inactivityMs);
  }

  async setMaster(password: string): Promise<void> {
    const salt = this.randomBytes(16);
    const key = await this.deriveKey(password, this.toArrayBuffer(salt), 150_000);
    const check = await this.encryptText(key, this.verificationText);

    const payload: StoredMaster = {
      salt: this.toB64(salt),
      check,
      iterations: 150_000
    };
    localStorage.setItem(this.masterStorageKey, JSON.stringify(payload));

    this.masterKey = key;
    this.state$.next('unlocked');
    this.touch();
  }

  async unlock(password: string): Promise<boolean> {
    const stored = this.loadStoredMaster();
    if (!stored) return false;
    const now = Date.now();
    this.expireCooldownIfElapsed(now);
    if (now < this.nextUnlockAt) {
      this.lastCooldownMs = this.nextUnlockAt - now;
      return false;
    }

    try {
      const salt = this.fromB64(stored.salt);
      const key = await this.deriveKey(password, this.toArrayBuffer(salt), stored.iterations || 150_000);
      const plain = await this.decryptText(key, stored.check);
      if (plain !== this.verificationText) {
        this.handleFailedAttempt();
        return false;
      }

      this.masterKey = key;
      this.state$.next('unlocked');
      this.failedAttempts = 0;
      this.nextUnlockAt = 0;
      this.lastCooldownMs = 0;
      this.clearAttemptState();
      this.touch();
      return true;
    } catch (err) {
      console.warn('[master] unlock failed', err);
      this.handleFailedAttempt();
      return false;
    }
  }

  async persistVault(data: unknown): Promise<void> {
    if (!this.masterKey) return;
    try {
      const json = JSON.stringify(data ?? null);
      const cipher = await this.encryptText(this.masterKey, json);
      localStorage.setItem(this.vaultStorageKey, cipher);
    } catch (err) {
      console.warn('[master] unable to persist vault cache', err);
    }
  }

  async loadCachedVault<T = any>(): Promise<T | null> {
    if (!this.masterKey) return null;
    try {
      const cipher = localStorage.getItem(this.vaultStorageKey);
      if (!cipher) return null;
      const json = await this.decryptText(this.masterKey, cipher);
      return JSON.parse(json) as T;
    } catch (err) {
      console.warn('[master] unable to load vault cache', err);
      return null;
    }
  }

  private loadStoredMaster(): StoredMaster | null {
    try {
      const raw = localStorage.getItem(this.masterStorageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed?.salt === 'string' && typeof parsed?.check === 'string') {
        return {
          salt: parsed.salt,
          check: parsed.check,
          iterations: parsed.iterations || 150_000
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  private async deriveKey(password: string, salt: ArrayBuffer, iterations: number): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations,
        hash: 'SHA-256'
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  private async encryptText(key: CryptoKey, text: string): Promise<string> {
    const enc = new TextEncoder();
    const iv = this.randomBytes(12);
    const cipherBuf = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: this.toArrayBuffer(iv) },
      key,
      enc.encode(text)
    );
    const combined = new Uint8Array(iv.byteLength + cipherBuf.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(cipherBuf), iv.byteLength);
    return this.toB64(combined);
  }

  private async decryptText(key: CryptoKey, b64: string): Promise<string> {
    const data = this.fromB64(b64);
    const iv = data.subarray(0, 12);
    const cipher = data.subarray(12);
    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: this.toArrayBuffer(iv) },
      key,
      this.toArrayBuffer(cipher)
    );
    return new TextDecoder().decode(plainBuf);
  }

  private toB64(u8: Uint8Array): string {
    let s = '';
    u8.forEach(b => (s += String.fromCharCode(b)));
    return btoa(s);
  }

  private fromB64(b64: string): Uint8Array {
    const s = atob(b64);
    const u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
      u8[i] = s.charCodeAt(i);
    }
    return u8;
  }

  private randomBytes(len: number): Uint8Array {
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return arr;
  }

  private toArrayBuffer(u8: Uint8Array): ArrayBuffer {
    // Copia a un ArrayBuffer real (evita SharedArrayBuffer)
    const copy = new Uint8Array(u8.byteLength);
    copy.set(new Uint8Array(u8.buffer, u8.byteOffset, u8.byteLength));
    return copy.buffer;
  }

  setAutoLockMinutes(minutes: number): void {
    const clamped = Math.max(1, Math.min(60, Math.round(minutes)));
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

  async rotateMaster(current: string, next: string): Promise<boolean> {
    const unlocked = await this.unlock(current);
    if (!unlocked) return false;

    const cached = await this.loadCachedVault<any>();
    await this.setMaster(next);

    if (cached) {
      await this.persistVault(cached);
    }

    // Forzar re-autenticacion con la nueva clave maestra
    this.lock();
    return true;
  }

  private loadAutoLock(): void {
    try {
      const raw = JSON.parse(localStorage.getItem(this.autoLockStorageKey) || '{}');
      if (typeof raw?.minutes === 'number' && raw.minutes > 0) {
        this.autoLockMinutes = Math.max(1, Math.min(60, Math.round(raw.minutes)));
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

  private handleFailedAttempt(): void {
    this.failedAttempts++;

    if (this.failedAttempts <= this.attemptPolicy.freeAttempts) {
      this.nextUnlockAt = 0;
      this.lastCooldownMs = 0;
      return;
    }

    const exponent = Math.max(0, this.failedAttempts - this.attemptPolicy.freeAttempts - 1);
    const rawDelay = this.attemptPolicy.baseDelayMs * Math.pow(this.attemptPolicy.growthFactor, exponent);
    const delay = Math.min(Number.MAX_SAFE_INTEGER / 2, rawDelay);
    this.nextUnlockAt = Date.now() + delay;
    this.lastCooldownMs = delay;
    this.persistAttemptState();
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
