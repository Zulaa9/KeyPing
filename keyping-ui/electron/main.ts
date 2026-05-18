// Punto de entrada del proceso principal (Electron).
import { app, BrowserWindow, BrowserWindowConstructorOptions, ipcMain, Menu, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { RAW_COMMON_WORDS } from './common-words';
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
  importVaultFromEncrypted,
  importVaultFromMasterEncrypted,
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
} from './vault';

import { findMostSimilarInVault } from './vault/similarity';
import { clipboard } from 'electron';
import { AutoUpdateService } from './updates/auto-update.service';
import { execFile } from 'node:child_process';
import { ClipboardClearSessionManager } from './clipboard-clear-session';

// Prefiere Wayland cuando está disponible (evita keylogging X11 por otras apps).
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
}

const CLIPBOARD_TTL_MS = 20_000;

let win: BrowserWindow | null = null;
let sessionUnlocked = false;
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const autoUpdateService = new AutoUpdateService(() => BrowserWindow.getAllWindows());

// Estado de intentos fallidos mantenido en el proceso principal (no manipulable desde el renderer).
const authAttemptState = {
  failedAttempts: 0,
  nextUnlockAt: 0,
  lastCooldownMs: 0,
  policy: { freeAttempts: 3, baseDelayMs: 5_000, growthFactor: 2 }
};

function recordMainFailedAttempt(): void {
  authAttemptState.failedAttempts++;
  if (authAttemptState.failedAttempts <= authAttemptState.policy.freeAttempts) return;
  const exponent = Math.max(0, authAttemptState.failedAttempts - authAttemptState.policy.freeAttempts - 1);
  const delay = Math.min(
    Number.MAX_SAFE_INTEGER / 2,
    authAttemptState.policy.baseDelayMs * Math.pow(authAttemptState.policy.growthFactor, exponent)
  );
  authAttemptState.nextUnlockAt = Date.now() + delay;
  authAttemptState.lastCooldownMs = delay;
}

function isMainCooldownActive(): boolean {
  const now = Date.now();
  if (authAttemptState.nextUnlockAt > 0 && now >= authAttemptState.nextUnlockAt) {
    authAttemptState.nextUnlockAt = 0;
    authAttemptState.lastCooldownMs = 0;
  }
  return authAttemptState.nextUnlockAt > 0 && Date.now() < authAttemptState.nextUnlockAt;
}

function clearWindowsClipboardHistory(): Promise<boolean> {
  // Limpia el historial de portapapeles de Windows (Win+V) en modo de mejor esfuerzo.
  if (!isWindows) return Promise.resolve(false);

  const psScript = `
    try {
      Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction Stop
      $null = [Windows.ApplicationModel.DataTransfer.Clipboard, Windows.ApplicationModel.DataTransfer, ContentType=WindowsRuntime]
      $ok = [Windows.ApplicationModel.DataTransfer.Clipboard]::ClearHistory()
      if ($ok) { exit 0 } else { exit 1 }
    } catch {
      exit 2
    }
  `;

  return new Promise(resolve => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
      { windowsHide: true, timeout: 4000 },
      err => {
        if (err) {
          console.warn('[main] windows clipboard history clear failed', err.message);
          resolve(false);
          return;
        }
        resolve(true);
      }
    );
  });
}

const clipboardSessionManager = new ClipboardClearSessionManager({
  readClipboardText: () => clipboard.readText(),
  clearClipboard: () => clipboard.clear(),
  clearWindowsClipboardHistory: isWindows ? clearWindowsClipboardHistory : undefined,
  schedule: (fn, ttlMs) => setTimeout(fn, ttlMs),
  cancel: handle => clearTimeout(handle),
  warn: (message, err) => console.warn(message, err)
});

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
      sandbox: true
    }
  };

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

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame) {
      console.error('[main] renderer failed to load', { errorCode, errorDescription, validatedURL });
    }
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[main] render process gone', details);
    sessionUnlocked = false;
  });

  win.webContents.on('did-navigate', () => {
    sessionUnlocked = false;
  });

  win.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')) {
      shell.openExternal(targetUrl);
    }
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, targetUrl) => {
    if (!targetUrl.startsWith('file://')) {
      e.preventDefault();
      if (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')) {
        void shell.openExternal(targetUrl);
      }
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  const rendererIndexPath = path.join(app.getAppPath(), 'dist', 'keyping-ui', 'browser', 'index.html');

  if (isLinux) {
    const gdkScale = parseInt(process.env['GDK_SCALE'] ?? '1', 10);
    if (gdkScale > 1) {
      win.webContents.once('did-finish-load', () => {
        win?.webContents.setZoomFactor(1 / gdkScale);
      });
    }
  }

  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    if (!fs.existsSync(rendererIndexPath)) {
      console.error('[main] renderer index.html not found at expected path:', rendererIndexPath);
    }
    void win.loadFile(rendererIndexPath);
  }

  if (!isLinux) {
    win.once('ready-to-show', () => win?.show());
  }
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  await runStartupMigrations().catch(err => console.error('[main] startup migration failed', err));
  void autoUpdateService.initialize();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  clipboardSessionManager.dispose();
});

/* ----------------------------------------------------------------
   Detector multilingüe de patrones (versión inicial)
   - normaliza mayúsculas/minúsculas, diacríticos y leet
   - detecta palabras comunes (EN/ES/FR/DE/PT/IT)
   - detecta secuencias numéricas y recorridos de teclado
   - detecta repeticiones y sufijos incrementales
   - valida longitud y variedad de caracteres
------------------------------------------------------------------ */

type Level = 'ok' | 'warn' | 'danger';

const KEYBOARD_RUNS = [
  'qwerty','asdf','zxcv','qwert','wasd',
  'azerty','qsdf','wxcv','azer'
];

const NUM_SEQUENCES = ['0123','1234','2345','3456','4567','5678','6789','7890'];
const YEAR_SUFFIX = /(19|20)\d{2}$/;

const LEET_MAP: Record<string,string> = {
  '0':'o','1':'i','2':'z','3':'e','4':'a','5':'s','6':'g','7':'t','8':'b','9':'g',
  '@':'a','$':'s','!':'i','¡':'i','¿':'','?':'','+':'t'
};

function normalizeBasic(s: string): string {
  let x = (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g,'')
    .replace(/[\s._\-:/\\|'",`~^°(){}\[\]]/g,'');
  x = x.replace(/[0123456789@$!¡\+\?]/g, m => LEET_MAP[m] ?? m);
  x = x.replace(/(.)\1{2,}/g, '$1$1');
  return x;
}

const COMMON_WORDS: Set<string> = (() => {
  const set = new Set<string>();
  for (const w of RAW_COMMON_WORDS) {
    const n = normalizeBasic(w);
    if (n && n.length >= 3) {
      set.add(n);
    }
  }
  console.log('[main] loaded common words:', set.size);
  return set;
})();


function classMask(s: string): number {
  let m = 0;
  if (/[a-z]/.test(s)) m |= 1;
  if (/[A-Z]/.test(s)) m |= 2;
  if (/\d/.test(s))   m |= 4;
  if (/[^A-Za-z0-9]/.test(s)) m |= 8;
  return m;
}

function hasCommonWord(nrm: string): string | null {
  if (COMMON_WORDS.has(nrm)) return nrm;

  for (const w of COMMON_WORDS) {
    if (!w) continue;
    if (w.length >= 4 && nrm.includes(w)) {
      return w;
    }
  }
  return null;
}

function hasSequence(nrm: string): string | null {
  if (NUM_SEQUENCES.some(seq => nrm.includes(seq))) return 'numeric sequence';
  if (KEYBOARD_RUNS.some(run => nrm.includes(run))) return 'keyboard run';
  if (/([a-z])\1{2,}/.test(nrm) || /(\d)\1{2,}/.test(nrm)) return 'repeated chars';
  return null;
}

function looksIncremental(orig: string): boolean {
  if (YEAR_SUFFIX.test(orig)) return true;

  const m = orig.match(/^(.*?)([!.?_\-])?(\d{1,4})$/);
  if (!m) return false;

  const prefix = m[1] || '';
  if (prefix.length <= 12) return true;

  return false;
}

async function checkPasswordBetter(pwd: string) {
  const reasons: string[] = [];
  let level: Level = 'ok';
  const nrm = normalizeBasic(pwd);
  const orig = pwd || '';

  if (!orig) return { level, reasons };

  const hit = hasCommonWord(nrm);
  if (hit) { level = 'danger'; reasons.push(`common word: "${hit}"`); }

  const seq = hasSequence(nrm);
  if (seq) { level = level === 'danger' ? 'danger' : 'warn'; reasons.push(seq); }

  if (looksIncremental(orig)) {
    level = level === 'danger' ? 'danger' : 'warn';
    reasons.push('incremental suffix (e.g., !1, 2024)');
  }

  const len = orig.length;
  const cm = classMask(orig);
  const classCount = ((cm & 1)?1:0)+((cm & 2)?1:0)+((cm & 4)?1:0)+((cm & 8)?1:0);

  if (len < 10) {
    level = level === 'danger' ? 'danger' : 'warn';
    reasons.push('short length (<10)');
  }
  if (classCount < 3) {
    level = level === 'danger' ? 'danger' : 'warn';
    reasons.push('low character variety');
  }

  if (/^(password|pass|contrasena|senha|passwort|motdepasse|admin)[^a-z]*\d{0,4}$/i.test(orig)) {
    level = 'danger';
    reasons.push('trivial base with small variation');
  }

  try {
    const best = await findMostSimilarInVault(orig);
    if (best) {
      const score = Math.round(best.score);
      const noteSnippet = best.entry.label ? ` (${best.entry.label})` : '';

      if (score >= 80) {
        level = 'danger';
        reasons.push(`similar to previous password${noteSnippet} (~${score}% match)`);
      } else if (score >= 60) {
        if (level === 'ok') level = 'warn';
        reasons.push(`somewhat similar to previous password${noteSnippet} (~${score}% match)`);
      }
    }
  } catch (err) {
    console.error('[main] similarity check error:', err);
  }

  return { level, reasons };
}

/* -------------------- Puente IPC --------------------- */

ipcMain.handle('keyping:ping', async () => {
  console.log('[main] ping');
  return 'pong';
});

ipcMain.handle('keyping:vaultIntegrity', async () => {
  if (!sessionUnlocked) throw new Error('Session locked');
  return await checkVaultIntegrity();
});

ipcMain.handle('keyping:getHistorySettings', async () => {
  if (!sessionUnlocked) throw new Error('Session locked');
  return await getHistorySettings();
});

ipcMain.handle('keyping:updateHistorySettings', async (_evt, maxHistoryPerEntry: number) => {
  if (!sessionUnlocked) throw new Error('Session locked');
  return await updateHistorySettings(maxHistoryPerEntry);
});

ipcMain.handle('keyping:compactVault', async (_evt, args?: { keepOnlyCurrent?: boolean; maxHistoryPerEntry?: number }) => {
  if (!sessionUnlocked) throw new Error('Session locked');
  return await compactVault({
    keepOnlyCurrent: !!args?.keepOnlyCurrent,
    maxHistoryPerEntry: args?.maxHistoryPerEntry
  });
});

ipcMain.handle('keyping:check', async (_evt, args: { pwd: string }) => {
  if (!sessionUnlocked) return { level: 'ok', reasons: [] };
  return await checkPasswordBetter(args?.pwd ?? '');
});

ipcMain.handle('keyping:save', async (_evt, args: {
  pwd: string;
  label?: string;
  loginUrl?: string;
  passwordChangeUrl?: string;
  username?: string;
  email?: string;
  folder?: string;
  twoFactorEnabled?: boolean;
  iconName?: string;
  iconSource?: 'auto' | 'manual';
  detectedService?: string;
}) => {
  if (!sessionUnlocked) throw new Error('Session locked');
  const entry = await addPasswordToVault(
    args.pwd,
    args.label,
    args.loginUrl,
    args.passwordChangeUrl,
    args.username,
    args.email,
    args.folder,
    args.twoFactorEnabled,
    args.iconName,
    args.iconSource,
    args.detectedService
  );
  const { id, createdAt, updatedAt, length, classMask, label, loginUrl, passwordChangeUrl, username, email, folder, twoFactorEnabled, iconName, iconSource, detectedService } = entry;
  return { id, createdAt, updatedAt, length, classMask, label, loginUrl, passwordChangeUrl, username, email, folder, twoFactorEnabled, iconName, iconSource, detectedService };
});

ipcMain.handle('keyping:list', async () => {
  if (!sessionUnlocked) return [];
  const entries = await getVaultEntries();
  return entries
    .filter(e => e.active !== false)
    .map(e => {
      const { id, createdAt, updatedAt, length, classMask, loginUrl, passwordChangeUrl, username, email, folder, twoFactorEnabled, iconName, iconSource, detectedService } = e;
      const label = e.label;
      return { id, createdAt, updatedAt, length, classMask, label, loginUrl, passwordChangeUrl, username, email, folder, twoFactorEnabled, iconName, iconSource, detectedService };
    });
});

ipcMain.handle('keyping:copy', async (_evt, args: { id: string }) => {
  if (!sessionUnlocked) return false;

  const secret = await getPasswordPlain(args.id);

  if (!secret) {
    console.warn('[main] no password in vault for id', args.id);
    return false;
  }

  clipboard.writeText(secret);
  clipboardSessionManager.startSession(secret, CLIPBOARD_TTL_MS);

  return true;
});

ipcMain.handle('keyping:copyText', (_evt, text: string) => {
  if (!sessionUnlocked) return false;
  if (typeof text !== 'string' || !text) return false;
  if (text.length > 10_000) return false;
  clipboard.writeText(text);
  clipboardSessionManager.startSession(text, CLIPBOARD_TTL_MS);
  return true;
});

ipcMain.handle('keyping:getPasswordHashes', async () => {
  if (!sessionUnlocked) return [];
  return await getPasswordHashes();
});

ipcMain.handle('keyping:delete', async (_evt, args: { id: string }) => {
  if (!sessionUnlocked) throw new Error('Session locked');
  await softDeleteEntry(args.id);
  return true;
});

ipcMain.handle('keyping:update', async (_evt, args: { id: string; pwd: string }) => {
  if (!sessionUnlocked) throw new Error('Session locked');
  const updated = await replacePasswordForEntry(args.id, args.pwd);
  if (!updated) throw new Error('Entry not found');

  const { id, createdAt, updatedAt, length, classMask, label, loginUrl, passwordChangeUrl, username, email, folder, twoFactorEnabled, iconName, iconSource, detectedService } = updated;
  return { id, createdAt, updatedAt, length, classMask, label, loginUrl, passwordChangeUrl, username, email, folder, twoFactorEnabled, iconName, iconSource, detectedService };
});

ipcMain.handle('keyping:updateMeta', async (_evt, args: {
  id: string;
  label?: string;
  loginUrl?: string;
  passwordChangeUrl?: string;
  username?: string;
  email?: string;
  folder?: string;
  twoFactorEnabled?: boolean;
  iconName?: string;
  iconSource?: 'auto' | 'manual';
  detectedService?: string;
}) => {
  if (!sessionUnlocked) throw new Error('Session locked');
  const entry = await updateEntryMeta(
    args.id,
    args.label,
    args.loginUrl,
    args.passwordChangeUrl,
    args.username,
    args.email,
    args.folder,
    args.twoFactorEnabled,
    args.iconName,
    args.iconSource,
    args.detectedService
  );
  const { id, createdAt, updatedAt, length, classMask, label, loginUrl, passwordChangeUrl, username, email, folder, twoFactorEnabled, iconName, iconSource, detectedService } = entry;
  return { id, createdAt, updatedAt, length, classMask, label, loginUrl, passwordChangeUrl, username, email, folder, twoFactorEnabled, iconName, iconSource, detectedService };
});

const mapHistoryEntry = (e: any) => {
  const { id, createdAt, updatedAt, length, classMask, label, loginUrl, passwordChangeUrl, username, email, folder, twoFactorEnabled, iconName, iconSource, detectedService, active, previousId } = e;
  return { id, createdAt, updatedAt, length, classMask, label, loginUrl, passwordChangeUrl, username, email, folder, twoFactorEnabled, iconName, iconSource, detectedService, active, previousId };
};

ipcMain.handle('keyping:getPasswordHistory', async (_evt, args: { id: string }) => {
  if (!sessionUnlocked) throw new Error('Session locked');
  const history = await getPasswordHistory(args.id);
  return history.map(mapHistoryEntry);
});

ipcMain.handle('keyping:restorePasswordVersion', async (_evt, args: { id: string }) => {
  if (!sessionUnlocked) throw new Error('Session locked');
  const restored = await restorePasswordVersion(args.id);
  if (!restored) throw new Error('Version not found');
  return mapHistoryEntry(restored);
});

ipcMain.handle('keyping:deletePasswordVersion', async (_evt, args: { id: string }) => {
  if (!sessionUnlocked) throw new Error('Session locked');
  return await deleteHistoryVersion(args.id);
});

ipcMain.handle('keyping:clearPasswordHistory', async (_evt, args: { id: string }) => {
  if (!sessionUnlocked) throw new Error('Session locked');
  return await deleteHistoryForEntry(args.id);
});

// El unlock verifica el cooldown en el proceso principal además de en el renderer.
ipcMain.handle('keyping:session:unlock', () => {
  if (isMainCooldownActive()) {
    throw new Error('Cooldown active');
  }
  sessionUnlocked = true;
});
ipcMain.handle('keyping:session:lock', () => { sessionUnlocked = false; });

// Gestión de intentos fallidos en el proceso principal (no manipulable desde el renderer).
ipcMain.handle('keyping:auth:failedAttempt', () => {
  recordMainFailedAttempt();
  return {
    failedAttempts: authAttemptState.failedAttempts,
    nextUnlockAt: authAttemptState.nextUnlockAt
  };
});

ipcMain.handle('keyping:auth:clearAttemptState', () => {
  authAttemptState.failedAttempts = 0;
  authAttemptState.nextUnlockAt = 0;
  authAttemptState.lastCooldownMs = 0;
});

ipcMain.handle('keyping:auth:getCooldown', () => {
  const now = Date.now();
  if (authAttemptState.nextUnlockAt > 0 && now >= authAttemptState.nextUnlockAt) {
    authAttemptState.nextUnlockAt = 0;
    authAttemptState.lastCooldownMs = 0;
  }
  return {
    failedAttempts: authAttemptState.failedAttempts,
    nextUnlockAt: authAttemptState.nextUnlockAt,
    remainingMs: Math.max(0, authAttemptState.nextUnlockAt - now)
  };
});

ipcMain.handle('keyping:getPassword', async (_evt, args: { id: string }) => {
  if (!sessionUnlocked) return null;
  return await getPasswordPlain(args.id);
});

ipcMain.handle('keyping:openExternal', async (_evt, rawUrl: string) => {
  try {
    let urlToOpen = (rawUrl || '').trim();

    if (!/^https?:\/\//i.test(urlToOpen)) {
      urlToOpen = 'https://' + urlToOpen;
    }

    const u = new URL(urlToOpen);

    if (u.protocol === 'http:' || u.protocol === 'https:') {
      await shell.openExternal(u.toString());
      return true;
    }
  } catch (err) {
    console.error('[main] invalid external url', rawUrl, err);
  }

  return false;
});

ipcMain.handle('keyping:exportVault', async (_evt, args?: { mode?: 'native' | 'master'; password?: string; includeHistory?: boolean }) => {
  if (!sessionUnlocked) throw new Error('Session locked');

  const mode = args?.mode || 'master';
  const includeHistory = args?.includeHistory !== false;

  if (mode === 'native') {
    const buf = await exportEncryptedVault(includeHistory);
    const filename = `keyping-vault-${new Date().toISOString().replace(/[:.]/g, '-')}.keyping`;
    return { base64: buf.toString('base64'), filename, format: 'keyping-export-v1', enc: 'native' };
  }

  if (!args?.password) {
    throw new Error('Password required for export');
  }

  const payload = await exportVaultWithPassword(args.password, includeHistory);
  const filename = `keyping-vault-${new Date().toISOString().replace(/[:.]/g, '-')}.kpenc`;
  return { payload, filename, format: payload.format, enc: payload.enc };
});

ipcMain.handle('keyping:parseImport', async (_evt, raw: string, password?: string) => {
  if (!sessionUnlocked) throw new Error('Session locked');
  return await parseImportPayload(raw, password);
});

ipcMain.handle('keyping:importVault', async (_evt, args: {
  mode: 'overwrite' | 'merge';
  entries: any[];
  encrypted?: string;
  enc?: 'native' | 'master' | 'plain';
  password?: string;
  masterPayload?: any;
}) => {
  if (!sessionUnlocked) throw new Error('Session locked');

  if (args.mode === 'overwrite') {
    const enc = args.enc || (args.encrypted ? 'native' : 'plain');
    let imported = 0;
    if (enc === 'master' && args.masterPayload && args.password) {
      imported = await importVaultFromMasterEncrypted(args.masterPayload, args.password);
    } else if (args.encrypted) {
      imported = await importVaultFromEncrypted(args.encrypted);
    } else {
      imported = await overwriteVaultWithEntries(args.entries || []);
    }
    return { imported, overwritten: true };
  }

  const imported = await mergeVaultEntries(args.entries || []);
  return { imported, overwritten: false };
});

ipcMain.handle('window:minimize', () => { win?.minimize(); });
ipcMain.handle('window:maximize', () => {
  if (win?.isMaximized()) win.unmaximize();
  else win?.maximize();
});
ipcMain.handle('window:close', () => { win?.close(); });
