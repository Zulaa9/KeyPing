// Servicio KeyPing para plataformas sin proceso principal (móvil). Implementa el mismo contrato
// que el preload del escritorio (window.keyping) con el núcleo compartido:
//   - autenticación: kp-auth.json { salt, iterations, check } con PBKDF2-HMAC-SHA512 (600 000)
//     y AES-256-GCM, igual que electron/vault/crypto.ts;
//   - bóveda: keyping-vault.kp = iv(12) || tag(16) || AES-256-GCM(JSON), guardada en base64;
//   - exportación/importación: core/export-format.ts (idéntica al escritorio).
// La clave de sesión solo existe en memoria mientras la bóveda está desbloqueada.
import type { CryptoProvider } from './crypto-provider';
import type { VaultData, VaultEntry, VaultIntegrityIssue, VaultIntegrityReport, VaultIntegrityStatus } from './types';
import { concatBytes, fromBase64, fromHex, toBase64, toHex, utf8Decode, utf8Encode, wipe } from './bytes';
import { hmacSha256Hex } from './sha256';
import { VaultOps } from './vault-ops';
import {
  DEFAULT_MAX_HISTORY,
  EntryMetaInput,
  ImportEntry,
  VaultUnreadableError,
  isPlausibleTimestamp,
  migrateVault,
  parseVaultJson,
  validateSecret
} from './vault-model';
import {
  EXPORT_EXTENSION_NATIVE,
  EXPORT_FORMAT_NATIVE,
  EXPORT_FORMAT_PORTABLE,
  MasterExportPayload,
  classifyImport,
  decryptMasterExport,
  encryptMasterExport,
  entriesFromJson,
  exportFilename,
  limitImport
} from './export-format';
import { AttemptGuard } from './attempt-policy';
import { checkPassword } from './password-check';
import { findMostSimilar } from './similarity';
import { safeExternalHref } from './url-utils';

export const AUTH_FILE = 'kp-auth.json';
export const VAULT_FILE = 'keyping-vault.kp';
export const PENDING_VAULT_FILE = 'keyping-vault.kp.pending';
export const HMAC_KEY_FILE = 'kp-hash.key';
export const SETTINGS_FILE = 'keyping-settings.json';
export const ATTEMPTS_FILE = 'kp-attempts.json';

export const AUTH_PBKDF2_ITER = 600_000;
const MIN_AUTH_ITER = 100_000;
const MAX_AUTH_ITER = 2_000_000;
const KEY_LEN = 32;
const VERIFY_TEXT = 'keyping-master-check';
const IV_LEN = 12;
const TAG_LEN = 16;
export const CLIPBOARD_TTL_MS = 20_000;
const MAX_ID_LENGTH = 128;
const MAX_IMPORT_TEXT = 25 * 1024 * 1024;
const PENDING_IMPORT_TTL_MS = 30 * 60 * 1000;

/** Almacenamiento privado de la app (texto). Cada write debe ser atómico. */
export type TextStore = {
  read(name: string): Promise<string | null>;
  write(name: string, data: string): Promise<void>;
  remove(name: string): Promise<void>;
};

export type NativeServices = {
  /** Copia marcando el contenido como sensible y lo borra a los ttlMs si sigue siendo el nuestro. */
  copySensitive(text: string, ttlMs: number): Promise<boolean>;
  clearClipboardIfOwned(): Promise<void>;
  /** Abre un enlace http(s) ya validado en el navegador del sistema. */
  openExternal(href: string): Promise<boolean>;
};

export type AuthResult =
  | { ok: true; warning?: 'vault-unreadable' | 'legacy-unverified' }
  | { ok: false; reason: 'invalid' | 'cooldown' | 'auth-missing' | 'vault-unreadable' | 'error'; remainingMs?: number; dataDir?: string };

type AuthRecord = { salt: string; iterations: number; check: string };

const PUBLIC_FIELDS = [
  'id', 'createdAt', 'updatedAt', 'length', 'classMask', 'label', 'loginUrl', 'passwordChangeUrl',
  'username', 'email', 'folder', 'twoFactorEnabled', 'iconName', 'iconSource', 'detectedService'
] as const;

// Lo que sale hacia la interfaz de una entrada: nunca `secret`, `hash` ni `normalized`.
function toPublic(e: any, withHistoryFields = false): any {
  const out: Record<string, unknown> = {};
  for (const k of PUBLIC_FIELDS) out[k] = e[k];
  if (withHistoryFields) {
    out['active'] = e.active;
    out['previousId'] = e.previousId;
  }
  return out;
}

function metaFrom(a: any): EntryMetaInput {
  return {
    label: a.label, loginUrl: a.loginUrl, passwordChangeUrl: a.passwordChangeUrl, username: a.username,
    email: a.email, folder: a.folder, twoFactorEnabled: a.twoFactorEnabled, iconName: a.iconName,
    iconSource: a.iconSource, detectedService: a.detectedService
  };
}

function validPassword(password: unknown, minLength = 1): password is string {
  return typeof password === 'string' && password.length >= minLength && password.length <= 1024;
}

function asId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > MAX_ID_LENGTH) throw new Error('Invalid id');
  return value;
}

function previewEntry(e: ImportEntry): Record<string, unknown> {
  const { secret, password, pwd, hash, normalized, ...rest } = e as any;
  void secret; void password; void pwd; void hash; void normalized;
  return rest;
}

function computeStatus(issues: VaultIntegrityIssue[]): VaultIntegrityStatus {
  if (!issues.length) return 'ok';
  const hasError = issues.some(i => i.code !== 'missing-file' && i.code !== 'implausible-timestamps');
  return hasError ? 'error' : 'warn';
}

export class KeypingService {
  private sessionKey: Uint8Array | null = null;
  /** Sube en cada bloqueo: una derivación que termina después de un bloqueo no debe abrir la sesión. */
  private lockGeneration = 0;
  private hmacKey: Uint8Array | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private pendingImport: { entries: ImportEntry[]; source: 'encrypted' | 'plain' | 'master'; at: number } | null = null;
  private lockListeners = new Set<() => void>();
  private readonly attempts: AttemptGuard;
  private readonly ops: VaultOps;
  private ready: Promise<void>;

  constructor(
    readonly platform: string,
    private readonly store: TextStore,
    private readonly crypto: CryptoProvider,
    private readonly native: NativeServices,
    private readonly now: () => number = Date.now
  ) {
    this.attempts = new AttemptGuard({
      read: () => store.read(ATTEMPTS_FILE),
      write: data => store.write(ATTEMPTS_FILE, data)
    }, now);
    this.ready = this.attempts.load();
    this.ops = new VaultOps({
      load: () => this.loadVault(),
      save: data => this.saveVault(data),
      hasher: async () => {
        const key = await this.getHmacKey();
        return (secret: string) => hmacSha256Hex(secret, key);
      },
      uuid: () => crypto.randomUUID(),
      now,
      historyLimit: async () => (await this.loadSettings()).maxHistoryPerEntry,
      lock: fn => this.withLock(fn)
    });
  }

  // ---------------- Infraestructura ----------------

  private withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private isUnlocked(): boolean {
    return !!this.sessionKey;
  }

  private guard<T>(fn: () => Promise<T> | T, whenLocked?: () => T): Promise<T> {
    if (!this.isUnlocked()) {
      if (whenLocked) return Promise.resolve(whenLocked());
      return Promise.reject(new Error('Session locked'));
    }
    return Promise.resolve().then(fn);
  }

  private async encrypt(plain: string, key: Uint8Array): Promise<string> {
    const iv = this.crypto.randomBytes(IV_LEN);
    const { ciphertext, tag } = await this.crypto.aesGcmEncrypt(key, iv, utf8Encode(plain));
    return toBase64(concatBytes(iv, tag, ciphertext));
  }

  private async decryptBytes(bytes: Uint8Array, key: Uint8Array): Promise<string> {
    if (bytes.length < IV_LEN + TAG_LEN) throw new Error('Ciphertext too short');
    const iv = bytes.subarray(0, IV_LEN);
    const tag = bytes.subarray(IV_LEN, IV_LEN + TAG_LEN);
    return utf8Decode(await this.crypto.aesGcmDecrypt(key, iv, bytes.subarray(IV_LEN + TAG_LEN), tag));
  }

  private async loadAuth(): Promise<AuthRecord | null> {
    try {
      const parsed = JSON.parse((await this.store.read(AUTH_FILE)) ?? '');
      if (typeof parsed?.salt !== 'string' || typeof parsed?.check !== 'string' || typeof parsed?.iterations !== 'number') return null;
      const it = Math.max(MIN_AUTH_ITER, Math.min(MAX_AUTH_ITER, Math.round(parsed.iterations)));
      return { salt: parsed.salt, check: parsed.check, iterations: it };
    } catch {
      return null;
    }
  }

  private async deriveNewAuth(password: string): Promise<{ auth: AuthRecord; key: Uint8Array }> {
    const salt = this.crypto.randomBytes(32);
    const key = await this.crypto.pbkdf2(password, salt, AUTH_PBKDF2_ITER, KEY_LEN, 'sha512');
    const iv = this.crypto.randomBytes(IV_LEN);
    const { ciphertext, tag } = await this.crypto.aesGcmEncrypt(key, iv, utf8Encode(VERIFY_TEXT));
    return { auth: { salt: toHex(salt), iterations: AUTH_PBKDF2_ITER, check: toHex(concatBytes(iv, tag, ciphertext)) }, key };
  }

  private async verifyAndDerive(password: string): Promise<Uint8Array | null> {
    const auth = await this.loadAuth();
    if (!auth) return null;
    const key = await this.crypto.pbkdf2(password, fromHex(auth.salt), auth.iterations, KEY_LEN, 'sha512');
    try {
      const check = fromHex(auth.check);
      if (check.length < IV_LEN + TAG_LEN + 1) throw new Error('short');
      const plain = await this.decryptBytes(check, key);
      if (plain === VERIFY_TEXT) return key;
    } catch {
      /* contraseña incorrecta */
    }
    wipe(key);
    return null;
  }

  private setSessionKey(key: Uint8Array): void {
    wipe(this.sessionKey);
    this.sessionKey = Uint8Array.from(key);
  }

  private async getHmacKey(): Promise<Uint8Array> {
    if (this.hmacKey) return this.hmacKey;
    try {
      const parsed = JSON.parse((await this.store.read(HMAC_KEY_FILE)) ?? '');
      const key = fromHex(parsed.key);
      if (key.length >= 16) return (this.hmacKey = key);
    } catch {
      /* se regenera abajo */
    }
    const key = this.crypto.randomBytes(32);
    await this.store.write(HMAC_KEY_FILE, JSON.stringify({ key: toHex(key) }));
    return (this.hmacKey = key);
  }

  private async loadSettings(): Promise<{ maxHistoryPerEntry: number }> {
    try {
      const parsed = JSON.parse((await this.store.read(SETTINGS_FILE)) ?? '');
      const v = Number.isFinite(parsed.maxHistoryPerEntry) ? parsed.maxHistoryPerEntry : DEFAULT_MAX_HISTORY;
      return { maxHistoryPerEntry: Math.min(200, Math.max(1, v)) };
    } catch {
      return { maxHistoryPerEntry: DEFAULT_MAX_HISTORY };
    }
  }

  private async readVaultBytes(name = VAULT_FILE): Promise<Uint8Array | null> {
    const text = await this.store.read(name);
    return text === null ? null : fromBase64(text);
  }

  private async loadVault(key: Uint8Array | null = this.sessionKey): Promise<VaultData> {
    if (!key) throw new Error('No active session');
    const bytes = await this.readVaultBytes();
    if (!bytes) return { entries: [] };
    if (bytes.byteLength < 28) throw new VaultUnreadableError('too-short');
    let json: string;
    try {
      json = await this.decryptBytes(bytes, key);
    } catch {
      throw new VaultUnreadableError('decrypt-failed');
    }
    return parseVaultJson(json, () => this.crypto.randomUUID());
  }

  private async saveVault(data: VaultData): Promise<void> {
    if (!this.sessionKey) throw new Error('No active session');
    await this.store.write(VAULT_FILE, await this.encrypt(JSON.stringify(data), this.sessionKey));
  }

  private async recoverPending(key: Uint8Array): Promise<void> {
    const pending = await this.store.read(PENDING_VAULT_FILE);
    if (pending === null) return;
    try {
      parseVaultJson(await this.decryptBytes(fromBase64(pending), key), () => this.crypto.randomUUID());
    } catch {
      // El auth nuevo nunca se guardó: el pendiente no sirve.
      await this.store.remove(PENDING_VAULT_FILE);
      return;
    }
    // Es la única copia cifrada con la clave actual: solo se borra si la promoción se ha escrito.
    await this.store.write(VAULT_FILE, pending);
    await this.store.remove(PENDING_VAULT_FILE);
  }

  private failAttempt(): AuthResult {
    this.attempts.recordFailure();
    const remainingMs = this.attempts.remainingMs();
    return remainingMs > 0 ? { ok: false, reason: 'cooldown', remainingMs } : { ok: false, reason: 'invalid' };
  }

  private async finishUnlock(): Promise<AuthResult> {
    await this.attempts.reset();
    try {
      await this.loadVault();
      return { ok: true };
    } catch {
      return { ok: true, warning: 'vault-unreadable' };
    }
  }

  /** Bloquea: borra la clave, la importación pendiente y el portapapeles si sigue siendo nuestro. */
  lockNow(notify = true): void {
    const was = this.isUnlocked();
    this.lockGeneration++;
    wipe(this.sessionKey);
    this.sessionKey = null;
    this.pendingImport = null;
    void this.native.clearClipboardIfOwned();
    if (notify && was) for (const l of this.lockListeners) l();
  }

  // ---------------- Contrato window.keyping ----------------

  minimizeWindow = async (): Promise<void> => {};
  maximizeWindow = async (): Promise<void> => {};
  closeWindow = async (): Promise<void> => {};
  ping = async () => 'pong';

  hasVault = async (): Promise<boolean> =>
    (await this.store.read(AUTH_FILE)) !== null || (await this.store.read(VAULT_FILE)) !== null;

  authSetup = async (password: unknown): Promise<AuthResult> => {
    await this.ready;
    if (!validPassword(password, 8)) throw new Error('Invalid password length');
    if (this.isUnlocked() || (await this.store.read(AUTH_FILE)) !== null) throw new Error('Unauthorized');
    if ((await this.store.read(VAULT_FILE)) !== null) return { ok: false, reason: 'auth-missing' };
    const { auth, key } = await this.deriveNewAuth(password);
    await this.store.write(AUTH_FILE, JSON.stringify(auth));
    this.setSessionKey(key);
    wipe(key);
    return this.finishUnlock();
  };

  authUnlock = async (password: unknown): Promise<AuthResult> => {
    const generation = this.lockGeneration;
    await this.ready;
    if (!validPassword(password)) return { ok: false, reason: 'invalid' };
    if (this.attempts.isCoolingDown()) return { ok: false, reason: 'cooldown', remainingMs: this.attempts.remainingMs() };
    try {
      if ((await this.store.read(AUTH_FILE)) === null) {
        return (await this.store.read(VAULT_FILE)) !== null ? { ok: false, reason: 'auth-missing' } : { ok: false, reason: 'invalid' };
      }
      const key = await this.verifyAndDerive(password);
      if (!key) return this.failAttempt();
      await this.withLock(() => this.recoverPending(key)).catch(() => undefined);
      if (generation !== this.lockGeneration) {
        // Se bloqueó (segundo plano, inactividad) mientras se derivaba la clave: no se abre la sesión.
        wipe(key);
        return { ok: false, reason: 'error' };
      }
      this.setSessionKey(key);
      wipe(key);
    } catch {
      return { ok: false, reason: 'error' };
    }
    return this.finishUnlock();
  };

  authChange = async (current: unknown, next: unknown): Promise<AuthResult> => {
    const generation = this.lockGeneration;
    await this.ready;
    if (!validPassword(current) || !validPassword(next, 8)) return { ok: false, reason: 'invalid' };
    if (this.attempts.isCoolingDown()) return { ok: false, reason: 'cooldown', remainingMs: this.attempts.remainingMs() };
    const currentKey = await this.verifyAndDerive(current);
    if (!currentKey) return this.failAttempt();
    wipe(currentKey);
    await this.attempts.reset();
    try {
      await this.withLock(async () => {
        const exists = (await this.store.read(VAULT_FILE)) !== null;
        const vault = exists ? await this.loadVault() : null; // ilegible -> aborta sin tocar nada
        const { auth, key } = await this.deriveNewAuth(next);
        // Dos fases: bóveda pendiente con la clave nueva -> kp-auth.json -> promoción.
        if (vault) await this.store.write(PENDING_VAULT_FILE, await this.encrypt(JSON.stringify(vault), key));
        await this.store.write(AUTH_FILE, JSON.stringify(auth));
        // Si se bloqueó durante el cambio, el cambio se completa pero la sesión sigue cerrada.
        if (generation === this.lockGeneration) this.setSessionKey(key);
        wipe(key);
        if (vault) {
          await this.store.write(VAULT_FILE, (await this.store.read(PENDING_VAULT_FILE))!);
          await this.store.remove(PENDING_VAULT_FILE);
        }
      });
    } catch (err) {
      return { ok: false, reason: err instanceof VaultUnreadableError ? 'vault-unreadable' : 'error' };
    }
    return { ok: true };
  };

  authVerify = async (password: unknown): Promise<boolean> => {
    if (!this.isUnlocked() || !validPassword(password) || this.attempts.isCoolingDown()) return false;
    const key = await this.verifyAndDerive(password);
    if (!key) {
      this.attempts.recordFailure();
      return false;
    }
    wipe(key);
    return true;
  };

  sessionLock = async (): Promise<void> => this.lockNow(false);

  onSessionLocked = (listener: () => void): (() => void) => {
    this.lockListeners.add(listener);
    return () => this.lockListeners.delete(listener);
  };

  getMainCooldown = async () => {
    await this.ready;
    return this.attempts.snapshot();
  };

  setAttemptPolicy = (policy: unknown) => this.guard(() => this.attempts.setPolicy(policy));

  checkCandidate = (pwd: unknown) =>
    this.guard(
      () => checkPassword(typeof pwd === 'string' ? pwd : '', async p => findMostSimilar(p, (await this.loadVault()).entries)),
      () => ({ level: 'ok', reasons: [], codes: [] }) as any
    );

  savePassword = (pwd: unknown, label?: string, loginUrl?: string, passwordChangeUrl?: string, username?: string,
    email?: string, folder?: string, twoFactorEnabled?: boolean, iconName?: string, iconSource?: 'auto' | 'manual',
    detectedService?: string) =>
    this.guard(async () => toPublic(await this.ops.add(validateSecret(pwd), metaFrom({
      label, loginUrl, passwordChangeUrl, username, email, folder, twoFactorEnabled, iconName, iconSource, detectedService
    }))));

  listPasswords = () =>
    this.guard(async () => (await this.ops.entries()).filter(e => e.active !== false).map(e => toPublic(e)), () => []);

  copyPassword = (id: unknown) =>
    this.guard(async () => {
      const secret = await this.ops.passwordPlain(asId(id));
      if (!secret) return false;
      return this.native.copySensitive(secret, CLIPBOARD_TTL_MS);
    }, () => false);

  copyText = (text: unknown) =>
    this.guard(async () => {
      if (typeof text !== 'string' || !text || text.length > 10_000) return false;
      return this.native.copySensitive(text, CLIPBOARD_TTL_MS);
    }, () => false);

  copySecure = (text: unknown) => this.copyText(text);

  getPasswordHashes = () => this.guard(() => this.ops.passwordHashes(), () => []);

  deletePassword = (id: unknown) => this.guard(async () => { await this.ops.softDelete(asId(id)); return true; });

  updatePassword = (id: unknown, pwd: unknown) =>
    this.guard(async () => {
      const updated = await this.ops.replacePassword(asId(id), validateSecret(pwd));
      if (!updated) throw new Error('Entry not found');
      return toPublic(updated);
    });

  updateMeta = (id: unknown, label?: string, loginUrl?: string, passwordChangeUrl?: string, username?: string,
    email?: string, folder?: string, twoFactorEnabled?: boolean, iconName?: string, iconSource?: 'auto' | 'manual',
    detectedService?: string) =>
    this.guard(async () => toPublic(await this.ops.updateMeta(asId(id), metaFrom({
      label, loginUrl, passwordChangeUrl, username, email, folder, twoFactorEnabled, iconName, iconSource, detectedService
    }))));

  getPasswordHistory = (id: unknown) =>
    this.guard(async () => (await this.ops.history(asId(id))).map(e => toPublic(e, true)));

  restorePasswordVersion = (id: unknown) =>
    this.guard(async () => {
      const restored = await this.ops.restoreVersion(asId(id));
      if (!restored) throw new Error('Version not found');
      return toPublic(restored, true);
    });

  deletePasswordVersion = (id: unknown) => this.guard(() => this.ops.deleteVersion(asId(id)));
  clearPasswordHistory = (id: unknown) => this.guard(() => this.ops.clearHistory(asId(id)));
  getPassword = (id: unknown) => this.guard(() => this.ops.passwordPlain(asId(id)), () => null);

  openExternal = async (rawUrl: unknown): Promise<boolean> => {
    const href = safeExternalHref(rawUrl);
    if (!href) return false;
    try {
      return await this.native.openExternal(href);
    } catch {
      return false;
    }
  };

  getHistorySettings = () => this.guard(() => this.loadSettings());

  updateHistorySettings = (maxHistoryPerEntry: unknown) =>
    this.guard(async () => {
      const v = Number(maxHistoryPerEntry);
      if (!Number.isFinite(v)) throw new Error('invalid-history-limit');
      const next = { maxHistoryPerEntry: Math.min(200, Math.max(1, v)) };
      await this.store.write(SETTINGS_FILE, JSON.stringify(next));
      return next;
    });

  compactVault = (keepOnlyCurrent?: boolean, maxHistoryPerEntry?: number) =>
    this.guard(() => this.ops.compact({
      keepOnlyCurrent: keepOnlyCurrent === true,
      maxHistoryPerEntry: typeof maxHistoryPerEntry === 'number' ? maxHistoryPerEntry : undefined
    }));

  checkVaultIntegrity = () => this.guard(() => this.integrity());

  private async integrity(): Promise<VaultIntegrityReport> {
    const issues: VaultIntegrityIssue[] = [];
    const checkedAt = this.now();
    const report = (fileExists: boolean, entries?: number): VaultIntegrityReport =>
      ({ status: computeStatus(issues), fileExists, issues, ...(entries === undefined ? {} : { entries }), checkedAt });
    let bytes: Uint8Array | null;
    try {
      bytes = await this.readVaultBytes();
    } catch {
      issues.push({ code: 'read-error' });
      return report(false);
    }
    if (!bytes) {
      issues.push({ code: 'missing-file' });
      return report(false);
    }
    if (bytes.byteLength < 28) {
      issues.push({ code: 'invalid-header', detail: 'too-short' });
      return report(true);
    }
    let json: string;
    try {
      json = await this.decryptBytes(bytes, this.sessionKey!);
    } catch {
      issues.push({ code: 'decrypt-failed' });
      return report(true);
    }
    let parsed: any;
    try {
      parsed = JSON.parse(json);
    } catch {
      issues.push({ code: 'invalid-json' });
      return report(true);
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entries)) {
      issues.push({ code: 'invalid-structure' });
      return report(true);
    }
    const migrated = migrateVault(parsed, () => this.crypto.randomUUID());
    const now = this.now();
    const implausible = migrated.entries.filter((entry: VaultEntry) => {
      const createdOk = isPlausibleTimestamp(entry.createdAt, now);
      const updatedOk = typeof entry.updatedAt === 'undefined'
        ? true
        : isPlausibleTimestamp(entry.updatedAt, now) && entry.updatedAt >= entry.createdAt;
      return !(createdOk && updatedOk);
    }).length;
    if (implausible > 0) issues.push({ code: 'implausible-timestamps', count: implausible });
    return report(true, migrated.entries.length);
  }

  // ---------------- Exportación e importación ----------------

  exportVault = (mode?: 'native' | 'master', password?: string, includeHistory?: boolean) =>
    this.guard(async () => {
      const history = includeHistory !== false;
      const json = await this.ops.exportJson(history);
      const at = new Date(this.now());
      if (mode === 'native') {
        const enc = await this.encrypt(json, this.sessionKey!);
        return { base64: enc, filename: exportFilename(at, EXPORT_EXTENSION_NATIVE), format: EXPORT_FORMAT_NATIVE, enc: 'native' };
      }
      if (!validPassword(password)) throw new Error('Password required for export');
      const { salt, iterations, data } = await encryptMasterExport(json, password, this.crypto);
      const payload: MasterExportPayload = { format: EXPORT_FORMAT_PORTABLE, enc: 'master', iterations, salt, data };
      return { payload, filename: exportFilename(at), format: payload.format, enc: payload.enc };
    });

  parseImport = (raw: unknown, password?: unknown) =>
    this.guard(async () => {
      if (typeof raw !== 'string' || raw.length > MAX_IMPORT_TEXT) throw new Error('invalid-import-file');
      const kind = classifyImport(raw);
      let entries: ImportEntry[];
      let source: 'encrypted' | 'plain' | 'master';
      if (kind.kind === 'master') {
        if (!validPassword(password)) {
          this.pendingImport = null;
          return { source: 'master', requiresPassword: true, entries: [] };
        }
        let json: string;
        try {
          json = await decryptMasterExport(kind.payload, password, this.crypto);
        } catch {
          throw new Error('import-wrong-password');
        }
        entries = limitImport(entriesFromJson(json));
        source = 'master';
      } else if (kind.kind === 'native') {
        let json: string;
        try {
          json = await this.decryptBytes(fromBase64(kind.vault), this.sessionKey!);
        } catch {
          // Exportación nativa: solo se puede abrir con la misma clave de sesión que la creó.
          throw new Error('import-native-key-mismatch');
        }
        entries = limitImport(entriesFromJson(json));
        source = 'encrypted';
      } else {
        entries = limitImport(entriesFromJson(kind.raw));
        source = 'plain';
      }
      this.pendingImport = { entries, source, at: this.now() };
      return { source, entries: entries.map(previewEntry) };
    });

  importVault = (modeInput: unknown, selection?: unknown) =>
    this.guard(async () => {
      const mode = modeInput === 'overwrite' ? 'overwrite' : modeInput === 'merge' ? 'merge' : null;
      if (!mode) throw new Error('invalid-import-mode');
      const pending = this.pendingImport;
      if (!pending || this.now() - pending.at > PENDING_IMPORT_TTL_MS) {
        this.pendingImport = null;
        throw new Error('import-expired');
      }
      if (mode === 'overwrite') {
        const imported = await this.ops.overwrite(pending.entries);
        this.pendingImport = null;
        return { imported, overwritten: true };
      }
      const sel: unknown[] = Array.isArray(selection) ? selection : [];
      const byId = new Map<string, ImportEntry>();
      for (const e of pending.entries) if (typeof e.id === 'string') byId.set(e.id, e);
      const now = this.now();
      const toMerge: ImportEntry[] = [];
      const used = new Set<number>();
      for (const s of sel) {
        const idx = Number((s as any)?.idx);
        if (!Number.isInteger(idx) || idx < 0 || idx >= pending.entries.length || used.has(idx)) continue;
        used.add(idx);
        const head = { ...pending.entries[idx] };
        const label = (s as any)?.label;
        if (typeof label === 'string') head.label = label.slice(0, 512);
        head.updatedAt = now;
        toMerge.push(head);
        // Versiones anteriores de esa entrada (historial) dentro del mismo archivo.
        const seen = new Set<string>(head.id ? [head.id] : []);
        let prev = typeof head.previousId === 'string' ? byId.get(head.previousId) : undefined;
        while (prev && !(prev.id && seen.has(prev.id))) {
          if (prev.id) seen.add(prev.id);
          toMerge.push(prev);
          prev = typeof prev.previousId === 'string' ? byId.get(prev.previousId) : undefined;
        }
      }
      const imported = await this.ops.merge(toMerge);
      this.pendingImport = null;
      return { imported, overwritten: false };
    });

  /** Objeto con la forma exacta de window.keyping (métodos enlazados). */
  asBridge(): Record<string, unknown> {
    const out: Record<string, unknown> = { platform: this.platform };
    for (const key of Object.keys(this)) {
      const v = (this as any)[key];
      if (typeof v === 'function') out[key] = v;
    }
    return out;
  }
}
