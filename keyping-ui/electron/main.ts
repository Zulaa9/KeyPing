// Punto de entrada del proceso principal (Electron).
import {
  app,
  BrowserWindow,
  BrowserWindowConstructorOptions,
  clipboard,
  ipcMain,
  IpcMainInvokeEvent,
  Menu,
  powerMonitor,
  session,
  shell
} from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import {
  addPasswordToVault,
  getVaultEntries,
  softDeleteEntry,
  replacePasswordForEntry,
  getPasswordPlain,
  updateEntryMeta,
  exportEncryptedVault,
  exportVaultWithPassword,
  parseImportPayload,
  overwriteVaultWithEntries,
  mergeVaultEntries,
  checkVaultIntegrity,
  getPasswordHistory,
  restorePasswordVersion,
  deleteHistoryVersion,
  deleteHistoryForEntry,
  compactVault,
  getHistorySettings,
  updateHistorySettings,
  getPasswordHashes,
  runStartupMigrations,
  validateSecret,
  EntryMetaInput,
  ImportEntry,
} from './vault';
import {
  loadVault,
  loadVaultWithKey,
  saveVault,
  vaultFileExists,
  writePendingVault,
  promotePendingVault,
  discardPendingVault,
  recoverPendingVault,
  VaultUnreadableError,
} from './vault/file';
import {
  hasAuthFile,
  setupMasterPassword,
  verifyPasswordAndDeriveKey,
  setSessionKey,
  clearSessionKey,
  hasSessionKey,
  deriveLegacyMasterKey,
  hasLegacyKeyFile,
  removeLegacyKeyFile,
  deriveNewAuth,
  commitAuth,
  verifyLegacyRendererCheck,
} from './vault/crypto';
import { withVaultLock } from './vault/fsutil';
import { dataDir, storeUserDataDir } from './vault/paths';
import { AttemptGuard } from './auth-attempts';
import { safeExternalHref } from './url-utils';
import { checkPasswordBetter } from './password-check';
import { AutoUpdateService } from './updates/auto-update.service';
import { ClipboardClearSessionManager } from './clipboard-clear-session';
import { writeSecretToWindowsClipboard } from './windows-clipboard';
import { getLinuxWindowIcon } from './window-icon';
import { disableSpellcheckDownloads } from './spellcheck';

// En la app instalada no se permite abrir un puerto de depuración remota: otro programa del
// equipo podría lanzar KeyPing así y leer la sesión desbloqueada. (Los fuses ya bloquean
// --inspect y NODE_OPTIONS; este switch es de Chromium y no lo cubre ningún fuse.)
const DEBUG_SWITCHES = ['remote-debugging-port', 'remote-debugging-pipe', 'remote-debugging-address'];
if (app.isPackaged && DEBUG_SWITCHES.some(s => app.commandLine.hasSwitch(s))) {
  console.error('[main] remote debugging is not allowed in the packaged app');
  app.exit(1);
  process.exit(1);
}

// Prefiere Wayland cuando está disponible (evita keylogging X11 por otras apps).
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
}

// Solo en desarrollo o pruebas: permite aislar los datos en un directorio temporal y no tocar
// nunca la bóveda real del equipo (npm run dev, Playwright).
if (!app.isPackaged && process.env.KEYPING_USER_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.KEYPING_USER_DATA_DIR));
} else if (process.windowsStore === true) {
  // La versión de Microsoft Store tiene datos propios (dentro del paquete; se borran al
  // desinstalarla) y nunca lee ni copia la bóveda de la versión de GitHub (%APPDATA%\keyping-ui).
  app.setPath('userData', storeUserDataDir(app.getPath('appData')));
}

const CLIPBOARD_TTL_MS = 20_000;
const MAX_ID_LENGTH = 128;
const MAX_IMPORT_TEXT = 25 * 1024 * 1024;
// Una instalación empaquetada nunca carga un servidor de desarrollo, aunque exista la variable.
const DEV_SERVER_URL = !app.isPackaged ? process.env.VITE_DEV_SERVER_URL : undefined;

let win: BrowserWindow | null = null;
let sessionUnlocked = false;
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const attempts = new AttemptGuard();

function rendererIndexPath(): string {
  return path.join(app.getAppPath(), 'dist', 'keyping-ui', 'browser', 'index.html');
}

function isTrustedRendererUrl(url: string): boolean {
  if (!url) return false;
  if (DEV_SERVER_URL) {
    try {
      return new URL(url).origin === new URL(DEV_SERVER_URL).origin;
    } catch {
      return false;
    }
  }
  // Solo el index.html de la app (la navegación interna usa #/ruta).
  // Con base href "./" y rutas hash, la URL del marco puede ser el directorio del renderer.
  const indexPath = rendererIndexPath();
  const index = pathToFileURL(indexPath).href;
  const dir = pathToFileURL(path.dirname(indexPath) + path.sep).href;
  const withoutHash = url.split('#')[0].split('?')[0];
  return withoutHash === index || withoutHash === dir;
}

// Solo la ventana principal de KeyPing, cargada desde los archivos de la app, puede usar el IPC.
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  if (!win || win.isDestroyed() || event.sender !== win.webContents) return false;
  const frame = event.senderFrame;
  if (!frame || frame !== win.webContents.mainFrame) return false;
  return isTrustedRendererUrl(frame.url);
}

function isUnlocked(): boolean {
  return sessionUnlocked && hasSessionKey();
}

type HandleOptions = { unlocked?: boolean; whenLocked?: () => unknown };

function handle(channel: string, fn: (...args: any[]) => unknown, opts: HandleOptions = {}): void {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted sender');
    if (opts.unlocked && !isUnlocked()) {
      if (opts.whenLocked) return opts.whenLocked();
      throw new Error('Session locked');
    }
    return fn(...args);
  });
}

function asId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > MAX_ID_LENGTH) throw new Error('Invalid id');
  return value;
}

function idArg(args: unknown): string {
  return asId((args as { id?: unknown } | undefined)?.id);
}

const clipboardSessionManager = new ClipboardClearSessionManager({
  readClipboardText: () => clipboard.readText(),
  clearClipboard: () => clipboard.clear(),
  schedule: (fn, ttlMs) => setTimeout(fn, ttlMs),
  cancel: handle => clearTimeout(handle),
  warn: message => console.warn(message)
});

const autoUpdateService = new AutoUpdateService(() => BrowserWindow.getAllWindows(), isTrustedSender);

/** Bloquea la sesión en el proceso principal: borra la clave y el portapapeles propio. */
function lockSession(notifyRenderer: boolean): void {
  const wasUnlocked = sessionUnlocked;
  sessionUnlocked = false;
  clearSessionKey();
  pendingImport = null;
  void clipboardSessionManager.clearNowIfOwned();
  if (notifyRenderer && wasUnlocked && win && !win.isDestroyed()) {
    win.webContents.send('keyping:session:locked');
  }
}

function createWindow() {
  const isLinux = process.platform === 'linux';
  const windowOptions: BrowserWindowConstructorOptions = {
    width: 1100,
    height: 720,
    show: isLinux,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // Sin DevTools en la app publicada: nadie con acceso a la ventana puede inspeccionar secretos.
      devTools: !app.isPackaged,
      // El corrector de Chromium descarga diccionarios de Internet en Linux y analizaría lo que se escribe.
      spellcheck: false
    }
  };

  const linuxIcon = getLinuxWindowIcon({
    platform: process.platform,
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath
  });
  if (linuxIcon) windowOptions.icon = linuxIcon;

  if (isWindows || isMac) {
    windowOptions.titleBarStyle = 'hidden';
    windowOptions.titleBarOverlay = {
      color: '#0b1220',
      symbolColor: '#e5e7eb',
      height: 32
    };
  }

  if (isMac) {
    windowOptions.trafficLightPosition = { x: 18, y: 18 };
  }

  if (isLinux) {
    windowOptions.frame = false;
  }

  win = new BrowserWindow(windowOptions);
  autoUpdateService.attachWindow(win);

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
    if (isMainFrame) {
      console.error('[main] renderer failed to load', { errorCode, errorDescription });
    }
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[main] render process gone', details.reason);
    lockSession(false);
  });

  win.webContents.on('did-navigate', () => {
    lockSession(false);
  });

  win.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    const href = safeExternalHref(targetUrl);
    if (href) void shell.openExternal(href);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, targetUrl) => {
    if (isTrustedRendererUrl(targetUrl)) return;
    e.preventDefault();
    const href = safeExternalHref(targetUrl);
    if (href && /^https?:/i.test(targetUrl)) void shell.openExternal(href);
  });
  win.webContents.on('will-attach-webview', e => e.preventDefault());

  if (isLinux) {
    const gdkScale = parseInt(process.env['GDK_SCALE'] ?? '1', 10);
    if (gdkScale > 1) {
      win.webContents.once('did-finish-load', () => {
        win?.webContents.setZoomFactor(1 / gdkScale);
      });
    }
  }

  if (DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL);
  } else {
    const indexPath = rendererIndexPath();
    if (!fs.existsSync(indexPath)) {
      console.error('[main] renderer index.html not found at expected path:', indexPath);
    }
    void win.loadFile(indexPath);
  }

  if (!isLinux) {
    win.once('ready-to-show', () => win?.show());
  }

  win.on('closed', () => {
    win = null;
  });
}

// Una sola instancia: dos procesos escribiendo la misma bóveda a la vez podrían pisarse.
// Antes de que exista ninguna sesión: evita que Electron descargue diccionarios ortográficos.
app.on('session-created', session => disableSpellcheckDownloads(session));

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);

    // La app no necesita cámara, micrófono, notificaciones ni geolocalización.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'clipboard-sanitized-write');
    });
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'clipboard-sanitized-write');

    await attempts.load();

    // Suspender o bloquear la sesión del sistema bloquea también KeyPing.
    powerMonitor.on('suspend', () => lockSession(true));
    powerMonitor.on('lock-screen', () => lockSession(true));

    void autoUpdateService.initialize();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  void clipboardSessionManager.clearNowIfOwned();
  clipboardSessionManager.dispose();
  lockSession(false);
});

/* -------------------- Auth --------------------- */

type AuthResult =
  | { ok: true; warning?: 'vault-unreadable' | 'legacy-unverified' }
  | { ok: false; reason: 'invalid' | 'cooldown' | 'auth-missing' | 'vault-unreadable' | 'error'; remainingMs?: number; dataDir?: string };

type LegacyCheck = { salt?: unknown; check?: unknown; iterations?: unknown } | null | undefined;

function validPassword(password: unknown, minLength = 1): password is string {
  return typeof password === 'string' && password.length >= minLength && password.length <= 1024;
}

function failAttempt(): AuthResult {
  attempts.recordFailure();
  const remainingMs = attempts.remainingMs();
  return remainingMs > 0 ? { ok: false, reason: 'cooldown', remainingMs } : { ok: false, reason: 'invalid' };
}

/**
 * Tras verificar la contraseña: completa un cambio de contraseña interrumpido y repara bóvedas
 * que quedaron cifradas con la clave heredada por un corte durante la migración de la 1.1.x.
 */
async function postUnlockRecovery(key: Buffer): Promise<void> {
  await withVaultLock(async () => {
    await recoverPendingVault(key);
    if (!(await vaultFileExists())) return;
    try {
      await loadVaultWithKey(key);
      if (await hasLegacyKeyFile()) await removeLegacyKeyFile();
      return;
    } catch (err) {
      if (!(err instanceof VaultUnreadableError) || err.reason !== 'decrypt-failed') return;
    }
    const legacyKey = await deriveLegacyMasterKey();
    if (!legacyKey) return;
    try {
      const legacyVault = await loadVaultWithKey(legacyKey);
      await writePendingVault(legacyVault, key);
      await promotePendingVault();
      await removeLegacyKeyFile();
      console.warn('[main] recovered vault still encrypted with the legacy key');
    } catch {
      /* no-op: el estado de integridad informará del problema */
    } finally {
      legacyKey.fill(0);
    }
  });
}

/**
 * Migración desde el esquema heredado (kp-master.key, KeyPing <= 1.0.x) en dos fases:
 * vault pendiente con la clave nueva -> kp-auth.json -> promoción -> borrado de la clave heredada.
 * Un corte en cualquier punto deja un estado del que el siguiente desbloqueo se recupera solo.
 */
async function migrateFromLegacyKey(password: string, legacyCheck: LegacyCheck): Promise<AuthResult> {
  const verdict = verifyLegacyRendererCheck(password, legacyCheck);
  if (verdict === false) return failAttempt();

  return withVaultLock(async (): Promise<AuthResult> => {
    const vaultExists = await vaultFileExists();
    const legacyKey = await deriveLegacyMasterKey();

    if (!legacyKey) {
      if (vaultExists) {
        // Hay bóveda pero ninguna forma de abrirla: no se crea una contraseña nueva encima.
        return { ok: false, reason: 'auth-missing', dataDir: dataDir() };
      }
      await setupMasterPassword(password);
      return { ok: true };
    }

    let legacyVault;
    try {
      legacyVault = await loadVaultWithKey(legacyKey);
    } catch {
      return { ok: false, reason: 'vault-unreadable', dataDir: dataDir() };
    } finally {
      legacyKey.fill(0);
    }

    const { auth, key } = deriveNewAuth(password);
    try {
      if (vaultExists) await writePendingVault(legacyVault, key);
      await commitAuth(auth);
    } catch (err) {
      await discardPendingVault();
      key.fill(0);
      throw err;
    }
    setSessionKey(key);
    key.fill(0);
    if (vaultExists) await promotePendingVault();
    await removeLegacyKeyFile();
    // Sin verificador antiguo (localStorage borrado) no hay forma de comprobar que esta era la
    // contraseña de la 1.0.x: la clave heredada no depende de ella. Se avisa al usuario.
    return verdict === null && vaultExists ? { ok: true, warning: 'legacy-unverified' } : { ok: true };
  });
}

async function vaultReadableWarning(): Promise<AuthResult> {
  try {
    await loadVault();
    return { ok: true };
  } catch {
    return { ok: true, warning: 'vault-unreadable' };
  }
}

async function finishUnlock(): Promise<AuthResult> {
  sessionUnlocked = true;
  await attempts.reset();
  await runStartupMigrations().catch(err => console.error('[main] startup migration failed', err?.message));
  return vaultReadableWarning();
}

// Verifies the master password in the main process and unlocks the session.
// Handles first-launch migration from the legacy random-key scheme automatically.
handle('keyping:auth:unlock', async (password: unknown, legacyCheck?: LegacyCheck): Promise<AuthResult> => {
  if (!validPassword(password)) return { ok: false, reason: 'invalid' };
  if (attempts.isCoolingDown()) return { ok: false, reason: 'cooldown', remainingMs: attempts.remainingMs() };

  let migrationWarning: 'legacy-unverified' | undefined;
  try {
    if (await hasAuthFile()) {
      const key = await verifyPasswordAndDeriveKey(password);
      if (!key) return failAttempt();
      try {
        await postUnlockRecovery(key);
      } catch (err: any) {
        console.error('[main] post-unlock recovery failed', err?.message);
      }
      setSessionKey(key);
      key.fill(0);
    } else {
      const res = await migrateFromLegacyKey(password, legacyCheck);
      if (!res.ok) return res;
      if (res.warning === 'legacy-unverified') migrationWarning = res.warning;
    }
  } catch (err: any) {
    console.error('[main] unlock failed', err?.message);
    return { ok: false, reason: 'error' };
  }

  const done = await finishUnlock();
  // Un aviso de bóveda ilegible pesa más que el de migración sin verificar.
  if (done.ok && !done.warning && migrationWarning) return { ok: true, warning: migrationWarning };
  return done;
});

// Initial setup only. Refuses when a vault or legacy key already exists (prevents takeover and
// prevents creating a new master password over a vault that could no longer be opened).
handle('keyping:auth:setup', async (password: unknown): Promise<AuthResult> => {
  if (!validPassword(password, 8)) throw new Error('Invalid password length');
  if (isUnlocked() || await hasAuthFile()) throw new Error('Unauthorized');
  if (await hasLegacyKeyFile()) {
    // Instalación 1.0.x sin datos en localStorage: se migra con la contraseña elegida.
    const res = await migrateFromLegacyKey(password, null);
    if (!res.ok) return res;
    const done = await finishUnlock();
    if (done.ok && !done.warning && res.warning) return { ok: true, warning: res.warning };
    return done;
  }
  if (await vaultFileExists()) return { ok: false, reason: 'auth-missing', dataDir: dataDir() };

  await setupMasterPassword(password);
  return finishUnlock();
});

/**
 * Cambio de contraseña maestra en dos fases. Verifica la actual en el proceso principal.
 * Si algo falla antes de guardar kp-auth.json, nada cambia; si falla después, el siguiente
 * desbloqueo con la contraseña nueva completa el cambio (recoverPendingVault).
 */
handle('keyping:auth:change', async (current: unknown, next: unknown): Promise<AuthResult> => {
  if (!validPassword(current) || !validPassword(next, 8)) return { ok: false, reason: 'invalid' };
  if (attempts.isCoolingDown()) return { ok: false, reason: 'cooldown', remainingMs: attempts.remainingMs() };
  const currentKey = await verifyPasswordAndDeriveKey(current);
  if (!currentKey) return failAttempt();
  currentKey.fill(0);
  await attempts.reset();

  try {
    await withVaultLock(async () => {
      const exists = await vaultFileExists();
      const vault = exists ? await loadVault() : null; // ilegible -> aborta sin tocar nada
      const { auth, key } = deriveNewAuth(next);
      try {
        if (vault) await writePendingVault(vault, key);
        await commitAuth(auth);
      } catch (err) {
        await discardPendingVault();
        key.fill(0);
        throw err;
      }
      setSessionKey(key);
      key.fill(0);
      if (vault) {
        try {
          await promotePendingVault();
        } catch {
          await saveVault(vault);
          await discardPendingVault();
        }
      }
    });
  } catch (err: any) {
    console.error('[main] master password change failed', err?.message);
    return { ok: false, reason: err instanceof VaultUnreadableError ? 'vault-unreadable' : 'error' };
  }
  return { ok: true };
});

handle('keyping:session:lock', () => {
  lockSession(false);
});

// Re-verifies the master password without altering session state.
// Used by sensitive operations (e.g., vault export) that require explicit re-confirmation.
handle('keyping:auth:verify', async (password: unknown) => {
  if (!validPassword(password)) return false;
  if (attempts.isCoolingDown()) return false;

  const key = await verifyPasswordAndDeriveKey(password);
  if (!key) {
    attempts.recordFailure();
    return false;
  }
  key.fill(0);
  return true;
}, { unlocked: true, whenLocked: () => false });

handle('keyping:auth:getCooldown', () => attempts.snapshot());

handle('keyping:auth:setPolicy', async (policy: unknown) => attempts.setPolicy(policy), { unlocked: true });

/* -------------------- Vault --------------------- */

const PUBLIC_FIELDS = [
  'id', 'createdAt', 'updatedAt', 'length', 'classMask', 'label', 'loginUrl', 'passwordChangeUrl',
  'username', 'email', 'folder', 'twoFactorEnabled', 'iconName', 'iconSource', 'detectedService'
] as const;

// Lo único que sale hacia el renderer de una entrada: nunca `secret`, `hash` ni `normalized`.
function toPublic(e: any, withHistoryFields = false): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of PUBLIC_FIELDS) out[k] = e[k];
  if (withHistoryFields) {
    out['active'] = e.active;
    out['previousId'] = e.previousId;
  }
  return out;
}

function metaFrom(args: any): EntryMetaInput {
  const a = args && typeof args === 'object' ? args : {};
  return {
    label: a.label,
    loginUrl: a.loginUrl,
    passwordChangeUrl: a.passwordChangeUrl,
    username: a.username,
    email: a.email,
    folder: a.folder,
    twoFactorEnabled: a.twoFactorEnabled,
    iconName: a.iconName,
    iconSource: a.iconSource,
    detectedService: a.detectedService
  };
}

handle('keyping:ping', () => 'pong');

// Hay datos que proteger: auth actual, clave heredada (1.0.x) o un vault sin auth.
handle('keyping:hasVault', async () =>
  (await hasAuthFile()) || (await hasLegacyKeyFile()) || (await vaultFileExists())
);

handle('keyping:vaultIntegrity', () => checkVaultIntegrity(), { unlocked: true });

handle('keyping:getHistorySettings', () => getHistorySettings(), { unlocked: true });

handle('keyping:updateHistorySettings', (maxHistoryPerEntry: unknown) =>
  updateHistorySettings(Number(maxHistoryPerEntry)), { unlocked: true });

handle('keyping:compactVault', (args?: { keepOnlyCurrent?: unknown; maxHistoryPerEntry?: unknown }) =>
  compactVault({
    keepOnlyCurrent: args?.keepOnlyCurrent === true,
    maxHistoryPerEntry: typeof args?.maxHistoryPerEntry === 'number' ? args.maxHistoryPerEntry : undefined
  }), { unlocked: true });

handle('keyping:check', (args: { pwd?: unknown }) => {
  const pwd = typeof args?.pwd === 'string' ? args.pwd : '';
  return checkPasswordBetter(pwd);
}, { unlocked: true, whenLocked: () => ({ level: 'ok', reasons: [], codes: [] }) });

handle('keyping:save', async (args: any) => {
  const entry = await addPasswordToVault(validateSecret(args?.pwd), metaFrom(args));
  return toPublic(entry);
}, { unlocked: true });

handle('keyping:list', async () => {
  const entries = await getVaultEntries();
  return entries.filter(e => e.active !== false).map(e => toPublic(e));
}, { unlocked: true, whenLocked: () => [] });

// Las copias se encadenan: el proceso auxiliar de Windows tarda unos instantes y dos copias
// seguidas no deben terminar en orden inverso.
let clipboardQueue: Promise<unknown> = Promise.resolve();

function copySensitiveText(text: string): Promise<void> {
  const run = clipboardQueue.then(async () => {
    const excluded = isWindows && await writeSecretToWindowsClipboard(text);
    if (!excluded) {
      if (isWindows) console.warn('[main] clipboard exclusion unavailable, using plain copy');
      await clipboard.writeText(text);
    }
    clipboardSessionManager.startSession(text, CLIPBOARD_TTL_MS);
  });
  clipboardQueue = run.catch(() => undefined);
  return run;
}

handle('keyping:copy', async (args: unknown) => {
  const secret = await getPasswordPlain(idArg(args));
  if (!secret) return false;
  await copySensitiveText(secret);
  return true;
}, { unlocked: true, whenLocked: () => false });

handle('keyping:copyText', async (text: unknown) => {
  if (typeof text !== 'string' || !text || text.length > 10_000) return false;
  await copySensitiveText(text);
  return true;
}, { unlocked: true, whenLocked: () => false });

handle('keyping:getPasswordHashes', () => getPasswordHashes(), { unlocked: true, whenLocked: () => [] });

handle('keyping:delete', async (args: unknown) => {
  await softDeleteEntry(idArg(args));
  return true;
}, { unlocked: true });

handle('keyping:update', async (args: any) => {
  const updated = await replacePasswordForEntry(idArg(args), validateSecret(args?.pwd));
  if (!updated) throw new Error('Entry not found');
  return toPublic(updated);
}, { unlocked: true });

handle('keyping:updateMeta', async (args: any) => {
  const entry = await updateEntryMeta(idArg(args), metaFrom(args));
  return toPublic(entry);
}, { unlocked: true });

handle('keyping:getPasswordHistory', async (args: unknown) => {
  const history = await getPasswordHistory(idArg(args));
  return history.map(e => toPublic(e, true));
}, { unlocked: true });

handle('keyping:restorePasswordVersion', async (args: unknown) => {
  const restored = await restorePasswordVersion(idArg(args));
  if (!restored) throw new Error('Version not found');
  return toPublic(restored, true);
}, { unlocked: true });

handle('keyping:deletePasswordVersion', (args: unknown) => deleteHistoryVersion(idArg(args)), { unlocked: true });

handle('keyping:clearPasswordHistory', (args: unknown) => deleteHistoryForEntry(idArg(args)), { unlocked: true });

handle('keyping:getPassword', (args: unknown) => getPasswordPlain(idArg(args)), { unlocked: true, whenLocked: () => null });

handle('keyping:openExternal', async (rawUrl: unknown) => {
  const href = safeExternalHref(rawUrl);
  if (!href) return false;
  try {
    await shell.openExternal(href);
    return true;
  } catch {
    console.error('[main] unable to open external url');
    return false;
  }
});

handle('keyping:exportVault', async (args?: { mode?: unknown; password?: unknown; includeHistory?: unknown }) => {
  const mode = args?.mode === 'native' ? 'native' : 'master';
  const includeHistory = args?.includeHistory !== false;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  if (mode === 'native') {
    const buf = await exportEncryptedVault(includeHistory);
    return { base64: buf.toString('base64'), filename: `keyping-vault-${stamp}.keyping`, format: 'keyping-export-v1', enc: 'native' };
  }

  if (!validPassword(args?.password)) throw new Error('Password required for export');
  const payload = await exportVaultWithPassword(args!.password as string, includeHistory);
  return { payload, filename: `keyping-vault-${stamp}.kpenc`, format: payload.format, enc: payload.enc };
}, { unlocked: true });

// Las entradas descifradas de un archivo de importación se quedan en el proceso principal.
// Al renderer solo llegan los metadatos para la vista previa; al confirmar, envía qué índices
// quiere y el proceso principal hace la importación con los secretos que ya tiene.
type PendingImport = { entries: ImportEntry[]; source: 'encrypted' | 'plain' | 'master'; at: number };
let pendingImport: PendingImport | null = null;
const PENDING_IMPORT_TTL_MS = 30 * 60 * 1000;

function takePendingImport(): PendingImport {
  if (!pendingImport || Date.now() - pendingImport.at > PENDING_IMPORT_TTL_MS) {
    pendingImport = null;
    throw new Error('import-expired');
  }
  return pendingImport;
}

function previewEntry(e: ImportEntry): Record<string, unknown> {
  const { secret, password, pwd, hash, normalized, ...rest } = e as any;
  void secret; void password; void pwd; void hash; void normalized;
  return rest;
}

handle('keyping:parseImport', async (raw: unknown, password?: unknown) => {
  if (typeof raw !== 'string' || raw.length > MAX_IMPORT_TEXT) throw new Error('invalid-import-file');
  const parsed = await parseImportPayload(raw, validPassword(password) ? password : undefined);
  pendingImport = parsed.requiresPassword ? null : { entries: parsed.entries, source: parsed.source, at: Date.now() };
  return {
    source: parsed.source,
    requiresPassword: parsed.requiresPassword,
    entries: parsed.entries.map(previewEntry)
  };
}, { unlocked: true });

handle('keyping:importVault', async (args: any) => {
  const mode = args?.mode === 'overwrite' ? 'overwrite' : args?.mode === 'merge' ? 'merge' : null;
  if (!mode) throw new Error('invalid-import-mode');
  const pending = takePendingImport();

  if (mode === 'overwrite') {
    const imported = await overwriteVaultWithEntries(pending.entries);
    pendingImport = null;
    return { imported, overwritten: true };
  }

  const selection: unknown[] = Array.isArray(args?.selection) ? args.selection : [];
  const byId = new Map<string, ImportEntry>();
  for (const e of pending.entries) if (typeof e.id === 'string') byId.set(e.id, e);
  const now = Date.now();
  const toMerge: ImportEntry[] = [];
  const used = new Set<number>();
  for (const sel of selection) {
    const idx = Number((sel as any)?.idx);
    if (!Number.isInteger(idx) || idx < 0 || idx >= pending.entries.length || used.has(idx)) continue;
    used.add(idx);
    const head = { ...pending.entries[idx] };
    const label = (sel as any)?.label;
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
  const imported = await mergeVaultEntries(toMerge);
  pendingImport = null;
  return { imported, overwritten: false };
}, { unlocked: true });

handle('window:minimize', () => { win?.minimize(); });
handle('window:maximize', () => {
  if (win?.isMaximized()) win.unmaximize();
  else win?.maximize();
});
handle('window:close', () => { win?.close(); });
