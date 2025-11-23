// main.ts
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import * as url from 'url';
import { RAW_COMMON_WORDS } from './common-words';
import { addPasswordToVault, getVaultEntries } from './vault';
import { findMostSimilarInVault } from './vault/similarity';



let win: BrowserWindow | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // basic hardening
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
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
  return /(.)+([!.?_\-])?\d{1,4}$/.test(orig) || YEAR_SUFFIX.test(orig) || /[\W_]$/.test(orig);
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
      const noteSnippet = best.entry.note
        ? ` (${best.entry.note})`
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

// analisis de contraseña
ipcMain.handle('keyping:check', async (_evt, args: { pwd: string }) => {
  console.log('[main] keyping:check called with:', JSON.stringify(args?.pwd));
  return await checkPasswordBetter(args?.pwd ?? '');
});

// guardar en vault cifrado (keyping-vault.kp)
ipcMain.handle('keyping:save', async (_evt, args: { pwd: string; note?: string }) => {
  console.log('[main] keyping:save called');  // 👈 log para tus tests
  const entry = await addPasswordToVault(args.pwd, args.note);
  const { id, createdAt, length, classMask, note } = entry;
  return { id, createdAt, length, classMask, note };
});

// listar entradas del vault
ipcMain.handle('keyping:list', async () => {
  console.log('[main] keyping:list called');  // 👈 log
  const entries = await getVaultEntries();
  return entries.map(e => {
    const { id, createdAt, length, classMask, note } = e;
    return { id, createdAt, length, classMask, note };
  });
});
