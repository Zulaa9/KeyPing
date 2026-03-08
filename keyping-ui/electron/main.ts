// main.ts
import { app, BrowserWindow, BrowserWindowConstructorOptions, ipcMain, Menu, shell } from 'electron';
import * as path from 'path';
import * as url from 'url';
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
} from './vault';

import { findMostSimilarInVault } from './vault/similarity';
import { clipboard } from 'electron';


let win: BrowserWindow | null = null;
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

function createWindow() {
  const windowOptions: BrowserWindowConstructorOptions = {
    width: 1100,
    height: 720,
    show: false,
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

  win = new BrowserWindow(windowOptions);

  // basic hardening + open external links in default browser
  win.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')) {
      shell.openExternal(targetUrl);
    }
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, targetUrl) => {
    if (!targetUrl.startsWith('file://')) {
      e.preventDefault();
      shell.openExternal(targetUrl);
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  const prodUrl = url.format({
    pathname: path.join(__dirname, '../dist/keyping-ui/browser/index.html'),
    protocol: 'file:',
    slashes: true
  });

  win.loadURL(devUrl ?? prodUrl);
  win.once('ready-to-show', () => win?.show());
}

app.whenReady().then(() => {
  // Remove default menu to hide devtools entrypoints
  // Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ----------------------------------------------------------------
   Multilingual pattern detector (MVP)
   - normalizes case, diacritics and leet speak
   - detects common words in EN/ES/FR/DE/PT/IT basics
   - detects numeric sequences and keyboard runs
   - detects repeated chars and incremental suffixes
   - checks length and character variety
------------------------------------------------------------------ */

type Level = 'ok' | 'warn' | 'danger';

const KEYBOARD_RUNS = [
  'qwerty','asdf','zxcv','qwert','wasd',
  'azerty','qsdf','wxcv','azer'
];

const NUM_SEQUENCES = ['0123','1234','2345','3456','4567','5678','6789','7890'];
const YEAR_SUFFIX = /(19|20)\d{2}$/;

// basic leet map
const LEET_MAP: Record<string,string> = {
  '0':'o','1':'i','2':'z','3':'e','4':'a','5':'s','6':'g','7':'t','8':'b','9':'g',
  '@':'a','$':'s','!':'i','¡':'i','¿':'','?':'','+':'t'
};

// normalize to compare across languages and styles
function normalizeBasic(s: string): string {
  let x = (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[\s._\-:/\\|'",`~^°(){}\[\]]/g,'');
  x = x.replace(/[0123456789@$!¡\+\?]/g, m => LEET_MAP[m] ?? m);
  x = x.replace(/(.)\1{2,}/g, '$1$1');
  return x;
}

// (2) Construye el diccionario normalizado UNA vez al arrancar:
const COMMON_WORDS: Set<string> = (() => {
  const set = new Set<string>();
  for (const w of RAW_COMMON_WORDS) {
    const n = normalizeBasic(w);
    // skip very short tokens (avoid "o", "i", etc.)
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
  // exact match -> siempre cuenta
  if (COMMON_WORDS.has(nrm)) return nrm;

  for (const w of COMMON_WORDS) {
    if (!w) continue;
    // solo buscamos dentro si la palabra comun tiene cierto tamano
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
  // Detecta sufijos incrementales típicos (123, 2024, !1) sin penalizar contraseñas largas aleatorias.
  if (YEAR_SUFFIX.test(orig)) return true;

  const m = orig.match(/^(.*?)([!.?_\-])?(\d{1,4})$/);
  if (!m) return false;

  const prefix = m[1] || '';
  const suffixDigits = m[3] || '';

  // Solo marcamos como incremental si el prefijo es relativamente corto (p.ej. "password", "token", "abc")
  // para evitar falsos positivos en contraseñas largas y aleatorias que simplemente acaban en un número.
  if (prefix.length <= 12) return true;

  // Prefijo largo => asumimos aleatorio, no penalizamos
  return false;
}

async function checkPasswordBetter(pwd: string) {
  const reasons: string[] = [];
  let level: Level = 'ok';
  const nrm = normalizeBasic(pwd);
  const orig = pwd || '';

  console.log('[main] RAW:', JSON.stringify(pwd), 'NORM:', nrm);

  if (!orig) return { level, reasons };

  // 1) reglas clasicas (diccionario, longitud, etc.)
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

  // 2) similitud con historico (modo B equilibrado)
  try {
    const best = await findMostSimilarInVault(orig);
    if (best) {
      const score = Math.round(best.score);
      const noteSnippet = best.entry.label
        ? ` (${best.entry.label})`
        : '';

      if (score >= 80) {
        // muy similar -> danger
        level = 'danger';
        reasons.push(`similar to previous password${noteSnippet} (~${score}% match)`);
      } else if (score >= 60) {
        // similar, pero no tan extrema -> warn
        if (level === 'ok') level = 'warn';
        reasons.push(`somewhat similar to previous password${noteSnippet} (~${score}% match)`);
      }
    }
  } catch (err) {
    console.error('[main] similarity check error:', err);
  }

  return { level, reasons };
}

/* -------------------- IPC bridge --------------------- */

// ping para diagnostico rapido
ipcMain.handle('keyping:ping', async () => {
  console.log('[main] ping');
  return `pong ${process.versions.electron}`;
});

ipcMain.handle('keyping:vaultIntegrity', async () => {
  return await checkVaultIntegrity();
});

ipcMain.handle('keyping:getHistorySettings', async () => {
  return await getHistorySettings();
});

ipcMain.handle('keyping:updateHistorySettings', async (_evt, maxHistoryPerEntry: number) => {
  return await updateHistorySettings(maxHistoryPerEntry);
});

ipcMain.handle('keyping:compactVault', async (_evt, args?: { keepOnlyCurrent?: boolean; maxHistoryPerEntry?: number }) => {
  return await compactVault({
    keepOnlyCurrent: !!args?.keepOnlyCurrent,
    maxHistoryPerEntry: args?.maxHistoryPerEntry
  });
});

// checker principal (nota: ahora es async)
ipcMain.handle('keyping:check', async (_evt, args: { pwd: string }) => {
  console.log('[main] keyping:check called with:', JSON.stringify(args?.pwd));
  return await checkPasswordBetter(args?.pwd ?? '');
});

// guardar nueva entrada
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

// listar solo activas
ipcMain.handle('keyping:list', async () => {
  const entries = await getVaultEntries();
  return entries
    .filter(e => e.active !== false)
    .map(e => {
      const { id, createdAt, updatedAt, length, classMask, loginUrl, passwordChangeUrl, username, email, folder, twoFactorEnabled, iconName, iconSource, detectedService } = e;
      const label = e.label;
      return { id, createdAt, updatedAt, length, classMask, label, loginUrl, passwordChangeUrl, username, email, folder, twoFactorEnabled, iconName, iconSource, detectedService };
    });
});

ipcMain.handle('keyping:open-external', async (_evt, rawUrl: string) => {
  try {
    const u = new URL(rawUrl);

    // Solo permitimos http/https por seguridad
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      await shell.openExternal(u.toString());
      return true;
    }
  } catch (err) {
    console.error('[main] invalid external url', rawUrl, err);
  }

  return false;
});

// Copiar password al portapapeles durante 20s
ipcMain.handle('keyping:copy', async (_evt, args: { id: string }) => {
  const secret = await getPasswordPlain(args.id);

  if (!secret) {
    console.warn('[main] no password in vault for id', args.id);
    return false;
  }

  clipboard.writeText(secret);

  const ttlMs = 20_000;
  setTimeout(() => {
    try {
      if (clipboard.readText() === secret) {
        clipboard.clear();
      }
    } catch (err) {
      console.error('[main] clipboard clear failed', err);
    }
  }, ttlMs);

  return true;
});



// Soft delete
ipcMain.handle('keyping:delete', async (_evt, args: { id: string }) => {
  await softDeleteEntry(args.id);
  return true;
});

// Editar password (crea nueva entrada y desactiva la antigua)
ipcMain.handle('keyping:update', async (_evt, args: { id: string; pwd: string }) => {
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
  const history = await getPasswordHistory(args.id);
  return history.map(mapHistoryEntry);
});

ipcMain.handle('keyping:restorePasswordVersion', async (_evt, args: { id: string }) => {
  const restored = await restorePasswordVersion(args.id);
  if (!restored) throw new Error('Version not found');
  return mapHistoryEntry(restored);
});

ipcMain.handle('keyping:deletePasswordVersion', async (_evt, args: { id: string }) => {
  return await deleteHistoryVersion(args.id);
});

ipcMain.handle('keyping:clearPasswordHistory', async (_evt, args: { id: string }) => {
  return await deleteHistoryForEntry(args.id);
});

ipcMain.handle('keyping:getPassword', async (_evt, args: { id: string }) => {
  return await getPasswordPlain(args.id); // devuelve string | null
});

ipcMain.handle('keyping:openExternal', async (_evt, rawUrl: string) => {
  try {
    let urlToOpen = (rawUrl || '').trim();

    // Si no tiene protocolo, le añadimos https:// al principio
    if (!/^https?:\/\//i.test(urlToOpen)) {
      urlToOpen = 'https://' + urlToOpen;
    }

    const u = new URL(urlToOpen);

    // Solo permitimos http/https por seguridad
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

